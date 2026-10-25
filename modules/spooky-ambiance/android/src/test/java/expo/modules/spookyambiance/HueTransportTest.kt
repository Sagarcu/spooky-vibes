package expo.modules.spookyambiance

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.net.InetAddress
import java.net.ServerSocket
import java.net.SocketException
import java.util.Collections
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class HueTransportTest {
  private fun withBridge(status: Int, response: String, test: (AmbianceSpec, MutableList<String>) -> Unit) {
    val requests = Collections.synchronizedList(mutableListOf<String>())
    val server = ServerSocket(0, 0, InetAddress.getByName("127.0.0.1"))
    val executor = Executors.newSingleThreadExecutor()
    val serving = executor.submit {
      while (!server.isClosed) {
        val socket = try { server.accept() } catch (error: SocketException) {
          if (server.isClosed) break else throw error
        }
        socket.use {
          socket.soTimeout = 5000
          val reader = socket.getInputStream().bufferedReader()
          val request = requireNotNull(reader.readLine())
          var contentLength = 0
          var header = reader.readLine()
          while (!header.isNullOrEmpty()) {
            if (header.startsWith("Content-Length:", ignoreCase = true)) contentLength = header.substringAfter(':').trim().toInt()
            header = reader.readLine()
          }
          val body = CharArray(contentLength)
          var read = 0
          while (read < contentLength) {
            val count = reader.read(body, read, contentLength - read)
            check(count > 0) { "The mock bridge received an incomplete request." }
            read += count
          }
          requests.add("${request.substringBeforeLast(' ')} ${String(body)}")
          val bytes = response.toByteArray()
          val redirect = if (status == 302) "Location: /redirected\r\n" else ""
          val headers = "HTTP/1.1 $status Response\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n$redirect\r\n"
          socket.getOutputStream().use { output ->
            output.write(headers.toByteArray())
            output.write(bytes)
            output.flush()
          }
        }
      }
    }
    try {
      val spec = AmbianceSpec.parse("""
        {
          "description":{"sequenceId":"candlelight","name":"Candlelight","targetName":"Room","lightIds":["1"]},
          "credentials":{"bridgeIp":"127.0.0.1:${server.localPort}","username":"placeholder"},
          "lights":[{"id":"1","kind":"dimmable","colorTemperatureCapable":false}]
        }
      """.trimIndent())
      test(spec, requests)
    } finally {
      server.close()
      executor.shutdown()
      try { serving.get(10, TimeUnit.SECONDS) } finally { executor.shutdownNow() }
    }
  }

  @Test fun sendsNativeStatesToTheMockBridgeAndRequiresConfirmation() {
    withBridge(200, """[{"success":{"/lights/1/state/on":true}}]""") { spec, requests ->
      runBlocking { sendHueState(spec, "1", JSONObject("""{"on":true,"bri":127}""")) }
      assertEquals(1, requests.size)
      assertTrue(requests.single().startsWith("PUT /api/placeholder/lights/1/state "))
      val state = JSONObject(requests.single().substringAfter("state "))
      assertTrue(state.getBoolean("on"))
      assertEquals(127, state.getInt("bri"))
    }
  }

  @Test fun bridgeAndHttpFailuresAreActionableWithoutExposingCredentials() {
    listOf(
      500 to "server error",
      200 to """[{"error":{"type":1,"address":"/placeholder/lights","description":"placeholder"}}]""",
      200 to """[{"success":{"/lights/1/state/on":true}},{"error":{"type":201,"address":"/placeholder/lights"}}]"""
    ).forEach { (status, response) ->
      withBridge(status, response) { spec, _ ->
        val error = assertThrows(IOException::class.java) {
          runBlocking { sendHueState(spec, "1", JSONObject("""{"on":true}""")) }
        }
        assertTrue(error.message!!.contains("Wi-Fi"))
        generateSequence<Throwable>(error) { it.cause }.forEach {
          assertFalse(it.message.orEmpty().contains("placeholder"))
        }
      }
    }
  }

  @Test fun emptyAndMalformedResponsesDoNotReportSuccessOrLeakResponseBodies() {
    listOf("[]", "[{}]", """[{"success":{}}]""", "placeholder invalid json").forEach { response ->
      withBridge(200, response) { spec, _ ->
        val error = assertThrows(IllegalArgumentException::class.java) {
          runBlocking { sendHueState(spec, "1", JSONObject("""{"on":true}""")) }
        }
        assertFalse(error.message!!.contains("placeholder"))
      }
    }
  }

  @Test fun redirectsAreNotFollowed() {
    withBridge(302, "redirect") { spec, requests ->
      assertThrows(IOException::class.java) {
        runBlocking { sendHueState(spec, "1", JSONObject("""{"on":true}""")) }
      }
      assertEquals(1, requests.size)
    }
  }
}
