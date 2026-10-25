package expo.modules.spookyambiance

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class AmbianceEngineTest {
  private class FakeAudio(val error: (String) -> Unit, private val failure: () -> Exception?) : AmbianceAudio {
    var prepared = 0
    var released = 0
    val played = mutableListOf<String>()
    override suspend fun prepare(clips: List<JSONObject>) {
      prepared++
      if (clips.isNotEmpty()) failure()?.let { throw it }
    }
    override fun play(id: String) { played.add(id) }
    override fun release() { released++ }
  }

  private class Harness(scope: TestScope) {
    val reservations = mutableMapOf<String, Set<String>>()
    val errors = mutableListOf<String>()
    val sent = mutableListOf<Triple<String, String, JSONObject>>()
    val audio = mutableListOf<FakeAudio>()
    var prepareFailure: Exception? = null
    var onSend: suspend (AmbianceSpec, String, JSONObject) -> Unit = { _, _, _ -> }
    val engine = AmbianceEngine(scope.backgroundScope, {}, { name, message -> errors.add("$name: $message") },
      { error -> FakeAudio(error) { prepareFailure }.also { audio.add(it) } },
      { spec, id, state ->
        sent.add(Triple(spec.name, id, JSONObject(state.toString())))
        onSend(spec, id, state)
      },
      { scope.testScheduler.currentTime }, reservations)
  }

  private fun spec(name: String, ids: List<String> = listOf("1"), audio: Boolean = false, lightEvents: Boolean = true): AmbianceSpec {
    val events = JSONArray()
    if (lightEvents) ids.forEach { id ->
      listOf(
        0 to """{"on":true,"bri":100,"hue":1000,"sat":200}""",
        400 to """{"on":true,"bri":50}""",
        700 to """{"on":true,"ct":455}"""
      ).forEach { (at, state) ->
        events.put(JSONObject().put("lightId", id).put("atMs", at).put("state", JSONObject(state)))
      }
    }
    val clips = if (audio) JSONArray("""[
      {"id":"background","uri":"file://background.wav","atMs":0,"durationMs":1000,"volume":0.5},
      {"id":"effect","uri":"file://effect.wav","atMs":500,"durationMs":100,"volume":1}
    ]""") else JSONArray()
    return AmbianceSpec.parse(JSONObject()
      .put("description", JSONObject().put("sequenceId", name).put("name", name).put("targetName", "Room").put("lightIds", JSONArray(ids)))
      .put("credentials", JSONObject().put("bridgeIp", "bridge.local").put("username", "placeholder"))
      .put("lights", JSONArray(ids.map { JSONObject().put("id", it).put("kind", "color").put("colorTemperatureCapable", true) }))
      .put("timeline", JSONObject().put("durationMs", 1000).put("events", events).put("audio", clips)).toString())
  }

  @Test fun timelinesAndAudioRepeatIndependentlyAndStopWithoutLaterCommands() = runTest {
    val h = Harness(this)
    val one = h.engine.start(spec("One", audio = true))
    h.engine.start(spec("Two", listOf("2")))
    runCurrent()
    advanceTimeBy(1000)
    runCurrent()
    assertEquals(4, h.sent.count { it.first == "One" })
    assertEquals(listOf("background", "effect", "background"), h.audio[0].played)
    assertEquals(2, h.audio[0].prepared)
    h.engine.stop(one)
    val stoppedCount = h.sent.count { it.first == "One" }
    advanceTimeBy(1000)
    runCurrent()
    assertEquals(stoppedCount, h.sent.count { it.first == "One" })
    assertTrue(h.sent.count { it.first == "Two" } > stoppedCount)
    h.engine.stopAll()
    val count = h.sent.size
    advanceTimeBy(2000)
    runCurrent()
    assertEquals(count, h.sent.size)
    assertEquals(0, h.engine.snapshot().length())
    assertTrue(h.audio.all { it.released > 0 })
  }

  @Test fun presetEngineUsesParsedSettingsAndSnapshotsConfigurationIdentity() = runTest {
    val h = Harness(this)
    val request = JSONObject("""{
      "description":{"sequenceId":"candlelight","name":"Saved candle","configurationId":"saved-1",
        "targetName":"Room","lightIds":["1","2","3"]},
      "credentials":{"bridgeIp":"bridge.local","username":"placeholder"},
      "lights":[
        {"id":"1","kind":"color","colorCapable":true,"colorTemperatureCapable":true},
        {"id":"2","kind":"tunable-white","colorCapable":false,"colorTemperatureCapable":true},
        {"id":"3","kind":"onoff-plug","colorCapable":false,"colorTemperatureCapable":false}
      ],
      "settings":{"minBrightness":17,"maxBrightness":17,
        "color":{"mode":"color","hue":54321,"saturation":123},"glowColor":{"mode":"keep"},
        "whiteColor":{"mode":"white","temperature":4000},"glowWhiteColor":{"mode":"white","temperature":2000}}
    }""")
    val id = h.engine.start(AmbianceSpec.parse(request.toString()))
    runCurrent()
    advanceTimeBy(2100)
    runCurrent()
    assertTrue(h.sent.size >= 6)
    h.sent.forEach { (_, lightId, state) ->
      assertTrue(state.getBoolean("on"))
      if (lightId == "3") {
        assertEquals(setOf("on"), state.keys().asSequence().toSet())
      } else {
        assertEquals(43, state.getInt("bri"))
        if (lightId == "1") {
          assertFalse(state.has("ct"))
          assertEquals(54321, state.getInt("hue"))
          assertEquals(123, state.getInt("sat"))
        } else {
          assertEquals(250, state.getInt("ct"))
          assertFalse(state.has("hue"))
          assertFalse(state.has("sat"))
        }
      }
    }
    assertEquals("saved-1", h.engine.snapshot().getJSONObject(0).getString("configurationId"))
    assertEquals(id, h.engine.snapshot().getJSONObject(0).getString("id"))
    h.engine.stop(id)
    assertEquals(0, h.engine.snapshot().length())
    assertTrue(h.errors.isEmpty())
  }

  @Test fun foregroundSuppressesOnlyReservedLightsAndRestoresTheirAccumulatedState() = runTest {
    val h = Harness(this)
    h.engine.start(spec("Mood", listOf("1", "2"), audio = true))
    runCurrent()
    h.reservations["home"] = setOf("1")
    h.engine.reserve(setOf("1"))
    advanceTimeBy(750)
    runCurrent()
    assertEquals(1, h.sent.count { it.second == "1" })
    assertEquals(3, h.sent.count { it.second == "2" })
    assertEquals(listOf("2"), h.engine.snapshot().getJSONObject(0).getJSONArray("activeLightIds").strings())
    assertEquals(listOf("background", "effect"), h.audio.single().played)
    h.reservations.remove("home")
    h.engine.release(setOf("1"))
    val restored = h.sent.last { it.second == "1" }.third
    assertEquals(50, restored.getInt("bri"))
    assertEquals(455, restored.getInt("ct"))
    assertFalse(restored.has("hue"))
    assertFalse(restored.has("sat"))
    h.engine.stopAll()
  }

  @Test fun stormEngineUsesIndependentWhiteGlowAndResumesDarkPhasesWithoutTemperature() = runTest {
    val h = Harness(this)
    val request = JSONObject("""{
      "description":{"sequenceId":"halloween-storm","name":"Storm","targetName":"Room","lightIds":["1","2"]},
      "credentials":{"bridgeIp":"bridge.local","username":"placeholder"},
      "lights":[
        {"id":"1","kind":"color","colorCapable":true},
        {"id":"2","kind":"tunable-white","colorCapable":false,"colorTemperatureCapable":true}
      ],
      "settings":{"minBrightness":50,"maxBrightness":50,
        "color":{"mode":"color","hue":12345,"saturation":67},
        "glowColor":{"mode":"white","temperature":4000},
        "whiteColor":{"mode":"white","temperature":6500},
        "glowWhiteColor":{"mode":"white","temperature":2000}}
    }""")
    h.engine.start(AmbianceSpec.parse(request.toString()))
    var glowSeen = false
    var darkAfterGlowSeen = false
    var burstSeen = false
    repeat(100) {
      runCurrent()
      val states = h.sent.takeLast(2).associate { it.second to it.third }
      val rgb = states.getValue("1")
      val white = states.getValue("2")
      when {
        !white.getBoolean("on") -> {
          assertFalse(rgb.has("ct"))
          assertFalse(white.has("ct"))
          if (glowSeen) {
            h.reservations["home"] = setOf("2")
            h.engine.reserve(setOf("2"))
            h.reservations.remove("home")
            h.engine.release(setOf("2"))
            val resumed = h.sent.last().third
            assertFalse(resumed.getBoolean("on"))
            assertFalse(resumed.has("ct"))
            darkAfterGlowSeen = true
          }
        }
        white.getInt("bri") == 3 -> {
          assertEquals(250, rgb.getInt("ct"))
          assertEquals(500, white.getInt("ct"))
          glowSeen = true
        }
        else -> {
          assertEquals(12345, rgb.getInt("hue"))
          assertEquals(154, white.getInt("ct"))
          burstSeen = true
        }
      }
      advanceTimeBy(18001)
    }
    assertTrue(glowSeen)
    assertTrue(darkAfterGlowSeen)
    assertTrue(burstSeen)
    h.engine.stopAll()
    assertTrue(h.errors.isEmpty())
  }

  @Test fun reservationWaitsForInFlightRequestsAndAlsoBlocksModesStartedDuringHome() = runTest {
    val h = Harness(this)
    val gate = CompletableDeferred<Unit>()
    h.onSend = { _, _, _ -> gate.await() }
    try {
      h.engine.start(spec("First"))
      runCurrent()
      h.reservations["home"] = setOf("1")
      val reserved = async { h.engine.reserve(setOf("1")) }
      runCurrent()
      assertFalse(reserved.isCompleted)
      h.engine.start(spec("Late"))
      runCurrent()
      assertEquals(1, h.sent.size)
      gate.complete(Unit)
      reserved.await()
      runCurrent()
      assertEquals(1, h.sent.size)
      h.reservations.remove("home")
      h.engine.release(setOf("1"))
      assertEquals(setOf("First", "Late"), h.sent.drop(1).map { it.first }.toSet())
    } finally {
      gate.complete(Unit)
      h.engine.stopAll()
    }
  }

  @Test fun stoppingDuringResumptionDrainsTheRequestBeforeRemovingTheMode() = runTest {
    val h = Harness(this)
    val gate = CompletableDeferred<Unit>()
    try {
      val id = h.engine.start(spec("Mood"))
      runCurrent()
      h.reservations["home"] = setOf("1")
      h.engine.reserve(setOf("1"))
      advanceTimeBy(450)
      runCurrent()
      h.onSend = { _, _, _ -> gate.await() }
      h.reservations.remove("home")
      val release = async { h.engine.release(setOf("1")) }
      runCurrent()
      val stopped = async { h.engine.stop(id) }
      runCurrent()
      assertFalse(stopped.isCompleted)
      assertTrue(h.engine.snapshot().getJSONObject(0).getBoolean("stopping"))
      gate.complete(Unit)
      release.await()
      stopped.await()
      val count = h.sent.size
      advanceTimeBy(2000)
      runCurrent()
      assertEquals(count, h.sent.size)
      assertEquals(0, h.engine.snapshot().length())
    } finally {
      gate.complete(Unit)
      h.engine.stopAll()
    }
  }

  @Test fun bridgeFailureStopsOnlyItsModeAndReportsTheFailure() = runTest {
    val h = Harness(this)
    h.onSend = { spec, _, _ -> if (spec.name == "Bad") throw IOException("Bridge unavailable") }
    h.engine.start(spec("Good", listOf("2")))
    h.engine.start(spec("Bad"))
    runCurrent()
    assertEquals(listOf("Bad: Bridge unavailable"), h.errors)
    assertEquals("Good", h.engine.snapshot().getJSONObject(0).getString("name"))
    assertEquals(1, h.engine.snapshot().length())
    h.engine.stopAll()
  }

  @Test fun audioPreparationFailuresRejectStartupAndReleaseResources() = runTest {
    val h = Harness(this)
    h.prepareFailure = IllegalStateException("Audio missing")
    val error = runCatching { h.engine.start(spec("Audio", audio = true)) }.exceptionOrNull()
    assertTrue(error is IllegalStateException)
    assertEquals("Audio missing", error!!.message)
    runCurrent()
    assertEquals(0, h.engine.snapshot().length())
    assertEquals(listOf("Audio: Audio missing"), h.errors)
    assertTrue(h.audio.single().released > 0)
  }

  @Test fun audioOnlyModesRepeatAndOutputDisconnectStopsAudioModesOnly() = runTest {
    val h = Harness(this)
    h.engine.start(spec("Audio", audio = true, lightEvents = false))
    h.engine.start(spec("Lights", listOf("2")))
    advanceTimeBy(1100)
    runCurrent()
    assertEquals(listOf("background", "effect", "background"), h.audio[0].played)
    assertFalse(h.sent.any { it.first == "Audio" })
    h.engine.stopAudio()
    assertEquals(1, h.engine.snapshot().length())
    assertEquals("Lights", h.engine.snapshot().getJSONObject(0).getString("name"))
    h.engine.stopAll()
  }

  @Test fun nestedReservationsResumeOnlyAfterTheLastOwnerReleases() = runTest {
    val h = Harness(this)
    h.reservations["home"] = setOf("1")
    h.reservations["preview"] = setOf("1")
    h.engine.start(spec("Mood"))
    runCurrent()
    assertTrue(h.sent.isEmpty())
    h.reservations.remove("home")
    h.engine.release(setOf("1"))
    assertTrue(h.sent.isEmpty())
    h.reservations.remove("preview")
    h.engine.release(setOf("1"))
    assertEquals(1, h.sent.size)
    h.audio.single().error("Audio output failed")
    runCurrent()
    assertEquals(listOf("Mood: Audio output failed"), h.errors)
    assertEquals(0, h.engine.snapshot().length())
  }
}
