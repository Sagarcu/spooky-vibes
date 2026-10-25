package expo.modules.spookyambiance

import android.Manifest
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

class SpookyAmbianceModule : Module() {
  private val listenerId = UUID.randomUUID().toString()
  private val tokens = mutableSetOf<String>()
  private val context get() = requireNotNull(appContext.reactContext) { "Reopen the app before starting ambiance." }

  override fun definition() = ModuleDefinition {
    Name("SpookyAmbiance")
    Events("onChange")

    OnStartObserving {
      AmbianceRuntime.listeners[listenerId] = { snapshot -> sendEvent("onChange", mapOf("snapshot" to snapshot)) }
    }
    OnStopObserving { AmbianceRuntime.listeners.remove(listenerId) }
    OnDestroy {
      AmbianceRuntime.listeners.remove(listenerId)
      AmbianceRuntime.scope.launch {
        tokens.toList().forEach { AmbianceRuntime.release(it) }
        tokens.clear()
      }
    }

    AsyncFunction("requestNotificationPermission") { promise: Promise ->
      if (Build.VERSION.SDK_INT >= 33) {
        Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, Manifest.permission.POST_NOTIFICATIONS)
      } else {
        promise.resolve(mapOf("granted" to NotificationManagerCompat.from(context).areNotificationsEnabled()))
      }
    }

    AsyncFunction("getSnapshot") Coroutine { ->
      withContext(Dispatchers.Main.immediate) { AmbianceRuntime.snapshot() }
    }
    AsyncFunction("start") Coroutine { json: String ->
      withContext(Dispatchers.Main.immediate) {
        val spec = AmbianceSpec.parse(json)
        check(NotificationManagerCompat.from(context).areNotificationsEnabled() &&
          (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)) {
          "Allow notifications in Android settings before starting ambiance."
        }
        check(context.getSystemService(NotificationManager::class.java)
          .getNotificationChannel(AmbianceService.CHANNEL)?.importance != NotificationManager.IMPORTANCE_NONE) {
          "Enable the Ambiance playback notification category in Android settings before starting ambiance."
        }
        val power = context.getSystemService(PowerManager::class.java)
        if (!power.isIgnoringBatteryOptimizations(context.packageName)) {
          context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          error("Allow Spooky Vibes to run without battery optimization in Android settings, then return and start ambiance again. This is needed for continuous light control while locked.")
        }
        val service = AmbianceRuntime.ensureService(context)
        service.engine.start(spec)
      }
    }
    AsyncFunction("stop") Coroutine { id: String ->
      withContext(Dispatchers.Main.immediate) { AmbianceRuntime.service?.engine?.stop(id); Unit }
    }
    AsyncFunction("stopAll") Coroutine { ->
      withContext(Dispatchers.Main.immediate) { AmbianceRuntime.service?.engine?.stopAll(); Unit }
    }
    AsyncFunction("reserve") Coroutine { token: String, ids: List<String> ->
      withContext(Dispatchers.Main.immediate) {
        tokens.add(token)
        AmbianceRuntime.reserve(token, ids.toSet())
      }
    }
    AsyncFunction("release") Coroutine { token: String ->
      withContext(Dispatchers.Main.immediate) {
        AmbianceRuntime.release(token)
        tokens.remove(token)
      }
    }
  }
}
