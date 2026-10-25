package expo.modules.spookyambiance

import android.os.SystemClock
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

internal class AmbianceEngine(
  private val scope: CoroutineScope,
  private val changed: () -> Unit,
  private val failed: (String, String) -> Unit,
  private val createAudio: ((String) -> Unit) -> AmbianceAudio,
  private val sendState: suspend (AmbianceSpec, String, JSONObject) -> Unit = ::sendHueState,
  private val now: () -> Long = SystemClock::elapsedRealtime,
  private val reservations: Map<String, Set<String>> = AmbianceRuntime.reservations
) {
  private class Mode(val spec: AmbianceSpec, val audio: AmbianceAudio) {
    val id = UUID.randomUUID().toString()
    var stopping = false
    lateinit var job: Job
    val desired = mutableMapOf<String, JSONObject>()
    val pending = mutableSetOf<CompletableDeferred<Unit>>()
  }

  private val modes = linkedMapOf<String, Mode>()
  private val locks = mutableMapOf<String, Mutex>()
  val hasModes get() = modes.isNotEmpty()
  val hasAudio get() = modes.values.any { it.spec.audio.isNotEmpty() }
  private fun blocked(id: String) = reservations.values.any { id in it }
  private fun lock(spec: AmbianceSpec, id: String) = locks.getOrPut("${spec.host}:$id") { Mutex() }

  fun snapshot(): JSONArray = JSONArray(modes.values.map { mode ->
    JSONObject(mode.spec.description.toString()).put("id", mode.id).put("stopping", mode.stopping)
      .put("activeLightIds", JSONArray(mode.spec.lightIds.filterNot { blocked(it) }))
  })

  suspend fun start(spec: AmbianceSpec): String {
    lateinit var mode: Mode
    mode = Mode(spec, createAudio { message ->
      failed(spec.name, message)
      scope.launch { stop(mode.id) }
    })
    val prepared = CompletableDeferred<Unit>()
    modes[mode.id] = mode
    mode.job = scope.launch(start = CoroutineStart.LAZY) {
      try {
        mode.audio.prepare(spec.audio)
        prepared.complete(Unit)
        if (spec.timeline == null) playPreset(mode) else {
          var firstLoop = true
          while (isActive) {
            if (!firstLoop) mode.audio.prepare(spec.audio)
            firstLoop = false
            try { playTimeline(mode) } finally { mode.audio.release() }
          }
        }
      } catch (cancelled: CancellationException) {
        prepared.completeExceptionally(IllegalStateException("Ambiance startup was stopped."))
        throw cancelled
      } catch (error: Exception) {
        prepared.completeExceptionally(error)
        failed(spec.name, error.message ?: "Ambiance playback failed.")
      } finally {
        mode.stopping = true
        mode.audio.release()
        withContext(NonCancellable) { mode.pending.toList().forEach { it.await() } }
        modes.remove(mode.id)
        changed()
      }
    }
    mode.job.invokeOnCompletion {
      if (!prepared.isCompleted) prepared.completeExceptionally(IllegalStateException("Ambiance startup was stopped."))
    }
    try {
      changed()
      mode.job.start()
    } catch (error: Exception) {
      modes.remove(mode.id)
      mode.job.cancel()
      changed()
      throw error
    }
    prepared.await()
    return mode.id
  }

  suspend fun stop(id: String) {
    val mode = modes[id] ?: return
    mode.stopping = true
    changed()
    mode.job.cancelAndJoin()
  }

  suspend fun stopAll() = coroutineScope {
    modes.keys.toList().forEach { id -> launch { stop(id) } }
  }

  suspend fun stopAudio() = coroutineScope {
    modes.values.filter { it.spec.audio.isNotEmpty() }.map { it.id }.forEach { id -> launch { stop(id) } }
  }

  suspend fun reserve(ids: Set<String>) {
    changed()
    modes.values.toList().forEach { mode ->
      mode.spec.lightIds.filter { it in ids }.forEach { id -> lock(mode.spec, id).withLock { } }
    }
  }

  suspend fun release(ids: Set<String>) = coroutineScope {
    changed()
    modes.values.toList().forEach { mode ->
      mode.desired.toMap().filterKeys { it in ids && !blocked(it) }.forEach { (id, state) ->
        launch {
          try {
            transmit(mode, id, state, resume = true)
          } catch (error: Exception) {
            if (error is CancellationException) throw error
            failed(mode.spec.name, error.message ?: "Could not resume ambiance.")
            stop(mode.id)
          }
        }
      }
    }
  }

  private suspend fun send(mode: Mode, id: String, state: JSONObject) {
    mode.desired[id] = accumulatedState(mode.desired[id], state)
    // Resuming a dark preset phase must not resend a previous glow's temperature.
    if (mode.spec.timeline == null && !state.optBoolean("on", true)) {
      mode.desired.getValue(id).remove("ct")
    }
    transmit(mode, id, state)
  }

  private suspend fun transmit(mode: Mode, id: String, state: JSONObject, resume: Boolean = false) {
    if (mode.stopping) return
    val pending = CompletableDeferred<Unit>()
    mode.pending.add(pending)
    try {
      lock(mode.spec, id).withLock {
        if (!mode.stopping && !blocked(id) && (!resume || mode.desired[id] === state)) sendState(mode.spec, id, state)
      }
    } finally {
      mode.pending.remove(pending)
      pending.complete(Unit)
    }
  }

  private suspend fun playPreset(mode: Mode) {
    var previous: PresetStep? = null
    while (mode.job.isActive) {
      val step = presetStep(mode.spec.sequenceId, previous, settings = mode.spec.settings)
      val started = now()
      coroutineScope {
        mode.spec.lightIds.forEach { id ->
          launch { send(mode, id, supportedPresetState(mode.spec.sequenceId, mode.spec.lights.getValue(id), step, mode.spec.settings)) }
        }
      }
      previous = step
      delay((step.durationMs - (now() - started)).coerceAtLeast(0))
    }
  }

  private suspend fun playTimeline(mode: Mode) = coroutineScope {
    val timeline = requireNotNull(mode.spec.timeline)
    data class Event(val at: Long, val light: JSONObject?, val audio: JSONObject?)
    val events = (timeline.getJSONArray("events").objects().map { Event(it.getLong("atMs"), it, null) } +
      mode.spec.audio.map { Event(it.getLong("atMs"), null, it) }).sortedBy { it.at }
    val started = now()
    events.forEach { event ->
      delay((started + event.at - now()).coerceAtLeast(0))
      event.audio?.let { mode.audio.play(it.getString("id")) }
      event.light?.let { light ->
        launch { send(mode, light.getString("lightId"), light.getJSONObject("state")) }
      }
    }
    delay((started + timeline.getLong("durationMs") - now()).coerceAtLeast(0))
  }

  fun destroy() {
    modes.values.toList().forEach { mode ->
      mode.stopping = true
      mode.job.cancel()
      mode.audio.release()
    }
  }
}
