package expo.modules.spookyambiance

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

internal suspend fun sendHueState(spec: AmbianceSpec, id: String, state: JSONObject) = withContext(Dispatchers.IO) {
  val connection = URL("http://${spec.host}/api/${spec.username}/lights/$id/state").openConnection() as HttpURLConnection
  try {
    connection.connectTimeout = 8000
    connection.readTimeout = 8000
    connection.requestMethod = "PUT"
    connection.instanceFollowRedirects = false
    connection.doOutput = true
    connection.setRequestProperty("Content-Type", "application/json")
    connection.outputStream.use { it.write(state.toString().toByteArray(Charsets.UTF_8)) }
    val status = connection.responseCode
    if (status !in 200..299) throw IOException("Hue Bridge returned HTTP $status.")
    val response = JSONArray(connection.inputStream.bufferedReader().use { it.readText() })
    require(response.length() > 0) { "The Hue Bridge did not confirm the lamp update." }
    response.objects().forEach { entry ->
      // Do not expose bridge response addresses, which can contain the application key.
      val error = entry.optJSONObject("error")
      if (error != null) throw IOException("Hue Bridge rejected a lamp update (error ${error.optInt("type")}). Check the lamp and bridge connection.")
      val success = entry.optJSONObject("success")
      require(success != null && success.keys().asSequence().any { it.startsWith("/lights/$id/state/") }) {
        "The Hue Bridge did not confirm the lamp update."
      }
    }
  } catch (_: IOException) {
    // Connection exceptions may include the credential-bearing request URL.
    throw IOException("Could not update the Hue lights. Check your Wi-Fi, bridge connection and pairing.")
  } catch (_: JSONException) {
    throw IllegalArgumentException("The Hue Bridge returned an invalid lamp-update response. Reconnect to the bridge.")
  } finally {
    connection.disconnect()
  }
}
