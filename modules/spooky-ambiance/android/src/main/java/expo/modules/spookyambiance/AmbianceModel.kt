package expo.modules.spookyambiance

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt
import kotlin.random.Random

internal fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
internal fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }

internal sealed class AmbianceColor {
  object Keep : AmbianceColor()
  data class White(val temperature: Int) : AmbianceColor()
  data class Color(val hue: Int, val saturation: Int) : AmbianceColor()

  fun applyTo(state: JSONObject) {
    when (this) {
      Keep -> Unit
      is White -> state.put("ct", (1000000.0 / temperature).roundToInt())
      is Color -> state.put("hue", hue).put("sat", saturation)
    }
  }

  companion object {
    fun parse(json: JSONObject): AmbianceColor = when (json.getString("mode")) {
      "keep" -> Keep
      "white" -> White(json.integerInRange("temperature", 2000..6500))
      "color" -> Color(json.integerInRange("hue", 0..65535), json.integerInRange("saturation", 0..254))
      else -> throw IllegalArgumentException("Invalid ambiance color.")
    }
  }
}

private fun JSONObject.integerInRange(key: String, range: IntRange): Int {
  val value = opt(key)
  require(value is Number && value.toDouble().isFinite() &&
    value.toDouble() % 1.0 == 0.0 && value.toDouble() in range.first.toDouble()..range.last.toDouble()) {
    "Invalid ambiance $key."
  }
  return value.toInt()
}

internal data class AmbianceSettings(
  val minBrightness: Int,
  val maxBrightness: Int,
  val color: AmbianceColor,
  val glowColor: AmbianceColor,
  val whiteColor: AmbianceColor = AmbianceColor.Keep,
  val glowWhiteColor: AmbianceColor = AmbianceColor.Keep
) {
  companion object {
    fun defaults(sequenceId: String) = if (sequenceId == "candlelight") {
      AmbianceSettings(8, 50, AmbianceColor.White(2200), AmbianceColor.White(2200))
    } else {
      AmbianceSettings(80, 100, AmbianceColor.White(6500), AmbianceColor.White(2200))
    }

    fun parse(json: JSONObject): AmbianceSettings {
      val min = json.integerInRange("minBrightness", 1..100)
      return AmbianceSettings(min, json.integerInRange("maxBrightness", min..100),
        AmbianceColor.parse(json.getJSONObject("color")), AmbianceColor.parse(json.getJSONObject("glowColor")),
        parseWhiteColor(json, "whiteColor"), parseWhiteColor(json, "glowWhiteColor"))
    }

    private fun parseWhiteColor(json: JSONObject, key: String): AmbianceColor {
      if (!json.has(key)) return AmbianceColor.Keep
      val value = json.opt(key)
      require(value is JSONObject && value.opt("mode") in listOf("keep", "white")) {
        "Invalid ambiance $key."
      }
      return AmbianceColor.parse(value)
    }
  }
}

internal data class AmbianceSpec(
  val description: JSONObject,
  val host: String,
  val username: String,
  val lights: Map<String, JSONObject>,
  val timeline: JSONObject?,
  val settings: AmbianceSettings
) {
  val lightIds = description.getJSONArray("lightIds").strings().distinct()
  val sequenceId = description.getString("sequenceId")
  val name = description.getString("name")
  val audio = timeline?.getJSONArray("audio")?.objects() ?: emptyList()

  companion object {
    fun parse(json: String): AmbianceSpec {
      val request = JSONObject(json)
      val credentials = request.getJSONObject("credentials")
      val host = credentials.getString("bridgeIp").trim()
        .replace(Regex("^https?://"), "").removeSuffix("/")
      require(Regex("^[a-zA-Z0-9.-]+(?::\\d+)?$").matches(host)) { "Enter a valid bridge address." }
      val username = credentials.getString("username")
      require(Regex("^[a-zA-Z0-9_-]+$").matches(username)) { "Reconnect your Hue Bridge." }
      val description = request.getJSONObject("description")
      val timeline = request.optJSONObject("timeline")
      val spec = AmbianceSpec(description, host, username,
        request.getJSONArray("lights").objects().associateBy { it.getString("id") }, timeline,
        if (request.has("settings")) AmbianceSettings.parse(request.getJSONObject("settings"))
        else AmbianceSettings.defaults(description.getString("sequenceId")))
      require(spec.lightIds.isNotEmpty() && spec.lightIds.all { Regex("^\\d+$").matches(it) && spec.lights.containsKey(it) }) {
        "Choose available Hue lamps."
      }
      require(spec.name.isNotBlank()) { "Choose an available sequence." }
      require(timeline != null || spec.sequenceId in listOf("candlelight", "halloween-storm")) { "Unknown ambiance sequence." }
      if (timeline != null) {
        val duration = timeline.getLong("durationMs")
        require(duration in 1000..120000) { "Invalid timeline duration." }
        val events = timeline.getJSONArray("events").objects()
        require(events.size <= 500 && spec.audio.size <= 101 && (events.isNotEmpty() || spec.audio.isNotEmpty())) { "Invalid timeline actions." }
        events.forEach {
          require(it.getString("lightId") in spec.lightIds && it.getLong("atMs") in 0 until duration) { "Invalid timeline lamp or time." }
          it.getJSONObject("state")
        }
        spec.audio.forEach {
          require(it.getLong("atMs") in 0 until duration && it.getLong("durationMs") > 0 &&
            it.getDouble("volume").isFinite() && it.getDouble("volume") in 0.0..1.0) { "Invalid audio clip." }
        }
        require(spec.audio.map { it.getString("id") }.distinct().size == spec.audio.size) { "Duplicate audio clips." }
      }
      return spec
    }
  }
}

internal fun accumulatedState(previous: JSONObject?, state: JSONObject): JSONObject {
  val next = JSONObject(previous?.toString() ?: "{}")
  if (state.has("ct")) listOf("hue", "sat", "xy").forEach { next.remove(it) }
  if (state.has("hue") || state.has("sat") || state.has("xy")) {
    next.remove("ct")
    if (state.has("xy")) listOf("hue", "sat").forEach { next.remove(it) } else next.remove("xy")
  }
  state.keys().forEach { next.put(it, state.get(it)) }
  return next
}

internal data class PresetStep(val state: JSONObject, val durationMs: Long, val brightness: Int, val quiet: Boolean)

internal fun presetStep(
  sequenceId: String,
  previous: PresetStep?,
  random: Random = Random.Default,
  settings: AmbianceSettings = AmbianceSettings.defaults(sequenceId)
): PresetStep {
  if (sequenceId == "candlelight") {
    val target = random.nextInt(settings.minBrightness, settings.maxBrightness + 1)
    val brightness = (target * 0.85 + (previous?.brightness ?: target) * 0.15).roundToInt()
      .coerceIn(settings.minBrightness, settings.maxBrightness)
    val duration = random.nextLong(600, 2001)
    val transition = 2 + random.nextInt(minOf(7, (duration / 100).toInt() - 1))
    val state = JSONObject().put("on", true).put("bri", (brightness * 2.54).roundToInt())
      .put("transitiontime", transition)
    settings.color.applyTo(state)
    return PresetStep(state, duration, brightness, false)
  }
  if (previous?.quiet == true) {
    val brightness = random.nextInt(settings.minBrightness, settings.maxBrightness + 1)
    val state = JSONObject().put("on", true).put("bri", (brightness * 2.54).roundToInt())
      .put("transitiontime", 0)
    settings.color.applyTo(state)
    return PresetStep(state, random.nextLong(1000, 3001), brightness, false)
  }
  val glow = random.nextDouble() >= 0.55
  val state = JSONObject().put("on", glow).put("transitiontime", 4)
  if (glow) {
    state.put("bri", 3)
    settings.glowColor.applyTo(state)
  }
  return PresetStep(state, random.nextLong(4000, 18001), if (glow) 1 else 0, true)
}

internal fun supportedPresetState(
  sequenceId: String,
  lamp: JSONObject,
  step: PresetStep,
  settings: AmbianceSettings = AmbianceSettings.defaults(sequenceId)
): JSONObject {
  if (lamp.getString("kind") == "onoff-plug") {
    return JSONObject().put("on", sequenceId != "halloween-storm" || !step.quiet)
  }
  val state = JSONObject(step.state.toString())
  // Older captured requests identify RGB lamps by kind rather than the capability flag.
  if (!lamp.optBoolean("colorCapable", lamp.getString("kind") == "color") ||
    lamp.getString("kind") == "dimmable-plug") {
    listOf("ct", "hue", "sat", "xy").forEach { state.remove(it) }
    if (lamp.getString("kind") != "dimmable-plug" &&
      lamp.optBoolean("colorTemperatureCapable", false) && state.optBoolean("on", false)) {
      val color = if (sequenceId == "halloween-storm" && step.quiet) settings.glowWhiteColor else settings.whiteColor
      color.applyTo(state)
    }
  }
  return state
}
