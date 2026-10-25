package expo.modules.spookyambiance

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

internal class AmbianceService : Service() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  internal lateinit var engine: AmbianceEngine
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null
  private var receiverRegistered = false
  private var stopping = false
  internal val isStopping get() = stopping
  internal val destroyed = CompletableDeferred<Unit>()
  private var idleStop: Job? = null
  private val noisyReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
        scope.launch { engine.stopAudio() }
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
    engine = AmbianceEngine(scope, ::changed, ::reportFailure, { AndroidAmbianceAudio(this, it) })
    try {
      getSystemService(NotificationManager::class.java).createNotificationChannel(
        NotificationChannel(CHANNEL, "Ambiance playback", NotificationManager.IMPORTANCE_LOW)
      )
      updateNotification()
      wakeLock = getSystemService(PowerManager::class.java)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "$packageName:ambiance").apply {
          setReferenceCounted(false)
          acquire()
        }
      @Suppress("DEPRECATION")
      wifiLock = (applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
        .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "$packageName:ambiance").apply {
          setReferenceCounted(false)
          acquire()
        }
      ContextCompat.registerReceiver(this, noisyReceiver, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
        ContextCompat.RECEIVER_NOT_EXPORTED)
      receiverRegistered = true
      AmbianceRuntime.ready(this)
    } catch (error: Exception) {
      AmbianceRuntime.startupFailed(IllegalStateException("Could not start Android ambiance. Check notification and battery settings, then try again."))
      stopSelf()
    }
  }

  private fun changed() {
    if (destroyed.isCompleted) return
    AmbianceRuntime.publish()
    idleStop?.cancel()
    if (engine.hasModes) updateNotification() else {
      idleStop = scope.launch {
        kotlinx.coroutines.delay(250)
        stopping = true
        ServiceCompat.stopForeground(this@AmbianceService, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
    }
  }

  private fun notification(): Notification {
    val open = requireNotNull(packageManager.getLaunchIntentForPackage(packageName))
      .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val stop = Intent(this, AmbianceService::class.java).setAction(STOP_ALL)
    val count = engine.snapshot().length()
    return NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle("Spooky Vibes ambiance")
      .setContentText(if (count == 0) "Starting ambiance..." else "$count ambiance mode${if (count == 1) "" else "s"} running")
      .setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop all",
        PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .build()
  }

  private fun reportFailure(name: String, message: String) {
    AmbianceRuntime.error(name, message)
    val open = requireNotNull(packageManager.getLaunchIntentForPackage(packageName))
    val notification = NotificationCompat.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.stat_notify_error)
      .setContentTitle("$name ambiance stopped")
      .setContentText(message)
      .setStyle(NotificationCompat.BigTextStyle().bigText(message))
      .setContentIntent(PendingIntent.getActivity(this, 2, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
      .setAutoCancel(true)
      .build()
    getSystemService(NotificationManager::class.java).notify(ERROR_NOTIFICATION_ID, notification)
  }

  private fun updateNotification() {
    var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
    if (engine.hasAudio) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
    ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(),
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) types else 0)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == STOP_ALL) {
      scope.launch {
        engine.stopAll()
        if (!engine.hasModes) { stopping = true; stopSelf() }
      }
    } else if (!engine.hasModes) {
      // A start promise can be cancelled while Android is creating the service.
      scope.launch {
        kotlinx.coroutines.delay(10000)
        if (!engine.hasModes) { stopping = true; stopSelf() }
      }
    }
    return START_NOT_STICKY
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    stopping = true
    stopSelf()
  }

  override fun onDestroy() {
    destroyed.complete(Unit)
    if (AmbianceRuntime.service === this) {
      AmbianceRuntime.service = null
      if (!stopping && engine.hasModes) AmbianceRuntime.error("Android playback", "Android stopped ambiance. Reopen the app and start it again.")
      AmbianceRuntime.publish()
    }
    engine.destroy()
    scope.cancel()
    if (receiverRegistered) unregisterReceiver(noisyReceiver)
    if (wifiLock?.isHeld == true) wifiLock?.release()
    if (wakeLock?.isHeld == true) wakeLock?.release()
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  companion object {
    internal const val CHANNEL = "spooky-ambiance"
    private const val NOTIFICATION_ID = 2417
    private const val ERROR_NOTIFICATION_ID = 2418
    private const val STOP_ALL = "expo.modules.spookyambiance.STOP_ALL"
  }
}
