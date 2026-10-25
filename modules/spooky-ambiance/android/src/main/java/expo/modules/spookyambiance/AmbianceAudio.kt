package expo.modules.spookyambiance

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal interface AmbianceAudio {
  suspend fun prepare(clips: List<JSONObject>)
  fun play(id: String)
  fun release()
}

internal class AndroidAmbianceAudio(private val context: Context, private val onError: (String) -> Unit) : AmbianceAudio {
  private val players = mutableMapOf<String, MediaPlayer>()

  override suspend fun prepare(clips: List<JSONObject>) {
    clips.forEach { clip ->
      val uri = Uri.parse(clip.getString("uri"))
      require(uri.scheme == "file") { "Replace the audio file in Sequence Creator." }
      val file = File(requireNotNull(uri.path)).canonicalFile
      require(listOf(context.filesDir, context.cacheDir).any { file.path.startsWith("${it.canonicalPath}${File.separator}") } && file.isFile) {
        "Audio file missing. Replace it in Sequence Creator."
      }
      val player = MediaPlayer()
      players[clip.getString("id")] = player
      player.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
      val volume = clip.getDouble("volume").toFloat()
      player.setVolume(volume, volume)
      player.setDataSource(file.path)
      try {
        withTimeout(10000) {
          suspendCancellableCoroutine<Unit> { continuation ->
            player.setOnPreparedListener { if (continuation.isActive) continuation.resume(Unit) }
            player.setOnErrorListener { _, _, _ ->
              if (continuation.isActive) continuation.resumeWithException(IllegalStateException("Could not read an ambiance audio file. Replace it in Sequence Creator."))
              true
            }
            player.prepareAsync()
          }
        }
      } catch (_: TimeoutCancellationException) {
        throw IllegalStateException("Audio preparation timed out. Replace the audio file in Sequence Creator.")
      }
      player.setOnPreparedListener(null)
      player.setOnErrorListener { _, _, _ ->
        onError("Audio playback failed. Check the audio file and device output.")
        true
      }
    }
  }

  override fun play(id: String) { players.getValue(id).start() }

  override fun release() {
    players.values.forEach { it.release() }
    players.clear()
  }
}
