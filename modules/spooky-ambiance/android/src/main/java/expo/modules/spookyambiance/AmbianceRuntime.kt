package expo.modules.spookyambiance

import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

internal object AmbianceRuntime {
  val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  var service: AmbianceService? = null
  private var starting: CompletableDeferred<AmbianceService>? = null
  val reservations = mutableMapOf<String, Set<String>>()
  val listeners = ConcurrentHashMap<String, (String) -> Unit>()
  private val errors = mutableListOf<JSONObject>()
  private var revision = 0L

  fun snapshot(): String = JSONObject().put("revision", revision)
    .put("modes", service?.engine?.snapshot() ?: JSONArray())
    .put("errors", JSONArray(errors)).toString()

  fun publish() {
    revision++
    val snapshot = snapshot()
    listeners.values.forEach { it(snapshot) }
  }

  fun error(name: String, message: String) {
    errors.add(JSONObject().put("id", UUID.randomUUID().toString()).put("name", name).put("message", message))
    if (errors.size > 20) errors.removeAt(0)
    publish()
  }

  fun ready(service: AmbianceService) {
    this.service = service
    starting?.complete(service)
    starting = null
  }

  fun startupFailed(error: Exception) {
    starting?.completeExceptionally(error)
    starting = null
  }

  suspend fun ensureService(context: Context): AmbianceService {
    service?.let {
      if (!it.isStopping) return it
      it.destroyed.await()
    }
    starting?.let { return withTimeout(10000) { it.await() } }
    val pending = CompletableDeferred<AmbianceService>()
    starting = pending
    try {
      ContextCompat.startForegroundService(context, Intent(context, AmbianceService::class.java))
      return withTimeout(10000) { pending.await() }
    } finally {
      if (starting === pending) starting = null
    }
  }

  suspend fun reserve(token: String, ids: Set<String>) {
    reservations[token] = ids
    service?.engine?.reserve(ids)
  }

  suspend fun release(token: String) {
    val ids = reservations.remove(token) ?: return
    service?.engine?.release(ids)
  }
}
