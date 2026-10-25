package expo.modules.spookyambiance

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.roundToInt
import kotlin.random.Random

class AmbianceModelTest {
  private val request = """
    {
      "description": {"sequenceId":"candlelight","name":"Candlelight","targetName":"Room","lightIds":["1","1","2"]},
      "credentials": {"bridgeIp":"http://bridge.local/","username":"placeholder"},
      "lights": [
        {"id":"1","kind":"color","colorTemperatureCapable":true},
        {"id":"2","kind":"dimmable","colorTemperatureCapable":false}
      ]
    }
  """.trimIndent()

  @Test fun parsesCapturedTargetsAndNormalizesHost() {
    val spec = AmbianceSpec.parse(request)
    assertEquals("bridge.local", spec.host)
    assertEquals(listOf("1", "2"), spec.lightIds)
    assertTrue(spec.audio.isEmpty())
    assertNull(spec.timeline)
    assertEquals(AmbianceSettings(8, 50, AmbianceColor.White(2200), AmbianceColor.White(2200)), spec.settings)
    assertEquals(AmbianceSettings(80, 100, AmbianceColor.White(6500), AmbianceColor.White(2200)),
      AmbianceSpec.parse(request.replace("candlelight", "halloween-storm")).settings)
  }

  private fun settingsJson() = JSONObject("""{
    "minBrightness":20,"maxBrightness":35,
    "color":{"mode":"color","hue":65535,"saturation":254},
    "glowColor":{"mode":"white","temperature":2000}
  }""")

  @Test fun parsesSettingsAndPreservesConfigurationIdentity() {
    val json = JSONObject(request).put("settings", settingsJson())
    json.getJSONObject("description").put("configurationId", "saved-candle")
    val spec = AmbianceSpec.parse(json.toString())
    assertEquals(AmbianceSettings(20, 35, AmbianceColor.Color(65535, 254), AmbianceColor.White(2000)), spec.settings)
    assertEquals("saved-candle", spec.description.getString("configurationId"))
    json.getJSONObject("settings").put("color", JSONObject("""{"mode":"keep"}"""))
    assertEquals(AmbianceColor.Keep, AmbianceSpec.parse(json.toString()).settings.color)
  }

  @Test fun rejectsInvalidBrightnessAndColorSettingsWithoutCoercingValues() {
    val invalid = listOf<Pair<String, Any>>(
      "minBrightness" to 0, "minBrightness" to 101, "minBrightness" to 1.5,
      "minBrightness" to "20", "maxBrightness" to 19, "maxBrightness" to 101,
      "maxBrightness" to 30.5, "maxBrightness" to "35",
      "color" to JSONObject("""{"mode":"unknown"}"""),
      "color" to JSONObject("""{"mode":"white","temperature":1999}"""),
      "color" to JSONObject("""{"mode":"white","temperature":6501}"""),
      "color" to JSONObject("""{"mode":"white","temperature":2200.5}"""),
      "color" to JSONObject("""{"mode":"white","temperature":"2200"}"""),
      "color" to JSONObject("""{"mode":"color","hue":-1,"saturation":0}"""),
      "color" to JSONObject("""{"mode":"color","hue":65536,"saturation":0}"""),
      "color" to JSONObject("""{"mode":"color","hue":0.5,"saturation":0}"""),
      "color" to JSONObject("""{"mode":"color","hue":0,"saturation":-1}"""),
      "color" to JSONObject("""{"mode":"color","hue":0,"saturation":255}"""),
      "color" to JSONObject("""{"mode":"color","hue":0,"saturation":1.5}"""),
      "glowColor" to JSONObject("""{"mode":"white","temperature":0}""")
    )
    invalid.forEach { (key, value) ->
      val json = JSONObject(request).put("settings", settingsJson().put(key, value))
      assertThrows("$key=$value", IllegalArgumentException::class.java) { AmbianceSpec.parse(json.toString()) }
    }
  }

  @Test fun whiteSettingsDefaultToKeepAndAcceptIndependentInclusiveTemperatures() {
    val legacy = AmbianceSpec.parse(JSONObject(request).put("settings", settingsJson()).toString()).settings
    assertEquals(AmbianceColor.Keep, legacy.whiteColor)
    assertEquals(AmbianceColor.Keep, legacy.glowWhiteColor)
    listOf(2000, 6500).forEach { temperature ->
      val settings = settingsJson()
        .put("whiteColor", JSONObject().put("mode", "white").put("temperature", temperature))
        .put("glowWhiteColor", JSONObject().put("mode", "white").put("temperature", 8500 - temperature))
      val parsed = AmbianceSpec.parse(JSONObject(request).put("settings", settings).toString()).settings
      assertEquals(AmbianceColor.White(temperature), parsed.whiteColor)
      assertEquals(AmbianceColor.White(8500 - temperature), parsed.glowWhiteColor)
      assertEquals(legacy.color, parsed.color)
      assertEquals(legacy.glowColor, parsed.glowColor)
    }
    val keep = settingsJson().put("whiteColor", JSONObject("""{"mode":"keep"}"""))
      .put("glowWhiteColor", JSONObject("""{"mode":"keep"}"""))
    assertEquals(legacy, AmbianceSpec.parse(JSONObject(request).put("settings", keep).toString()).settings)
  }

  @Test fun rejectsExplicitNullInvalidTypesAndRgbModesForBothWhiteSettings() {
    val invalid = listOf(
      JSONObject.NULL, true, 2200, "keep", org.json.JSONArray(),
      JSONObject(), JSONObject("""{"mode":null}"""), JSONObject("""{"mode":false}"""),
      JSONObject("""{"mode":"unknown"}"""),
      JSONObject("""{"mode":"color","hue":1000,"saturation":100}"""),
      JSONObject("""{"mode":"white"}"""),
      JSONObject("""{"mode":"white","temperature":null}"""),
      JSONObject("""{"mode":"white","temperature":true}"""),
      JSONObject("""{"mode":"white","temperature":"2200"}"""),
      JSONObject("""{"mode":"white","temperature":2200.5}"""),
      JSONObject("""{"mode":"white","temperature":1999}"""),
      JSONObject("""{"mode":"white","temperature":6501}""")
    )
    listOf("whiteColor", "glowWhiteColor").forEach { key ->
      invalid.forEach { value ->
        val json = JSONObject(request).put("settings", settingsJson().put(key, value))
        assertThrows("$key=$value", IllegalArgumentException::class.java) { AmbianceSpec.parse(json.toString()) }
      }
    }
  }

  @Test fun candleAndStormUseIndependentRgbAndAdjustableWhiteTonesWithoutColoringPlugsOrDarkness() {
    val settings = AmbianceSettings(20, 30, AmbianceColor.Color(12345, 67),
      AmbianceColor.White(4000), AmbianceColor.White(6500), AmbianceColor.White(2000))
    val rgb = JSONObject("""{"kind":"color"}""")
    val white = JSONObject("""{"kind":"tunable-white","colorCapable":false,"colorTemperatureCapable":true}""")
    val excluded = listOf(
      """{"kind":"dimmable","colorCapable":false,"colorTemperatureCapable":false}""",
      """{"kind":"onoff-plug","colorCapable":true,"colorTemperatureCapable":true}""",
      """{"kind":"dimmable-plug","colorCapable":true,"colorTemperatureCapable":true}"""
    ).map(::JSONObject)
    val random = Random(71)
    listOf("candlelight", "halloween-storm").forEach { sequence ->
      var previous: PresetStep? = null
      var glowSeen = false
      var darkSeen = false
      repeat(100) {
        val step = presetStep(sequence, previous, random, settings)
        val colorState = supportedPresetState(sequence, rgb, step, settings)
        val whiteState = supportedPresetState(sequence, white, step, settings)
        assertEquals(step.state.getBoolean("on"), whiteState.getBoolean("on"))
        assertEquals(step.state.opt("bri"), whiteState.opt("bri"))
        assertEquals(step.state.getInt("transitiontime"), whiteState.getInt("transitiontime"))
        assertFalse(whiteState.has("hue"))
        assertFalse(whiteState.has("sat"))
        if (!step.quiet) {
          assertEquals(12345, colorState.getInt("hue"))
          assertEquals(67, colorState.getInt("sat"))
          assertEquals(154, whiteState.getInt("ct"))
        } else if (step.state.getBoolean("on")) {
          glowSeen = true
          assertEquals(250, colorState.getInt("ct"))
          assertEquals(500, whiteState.getInt("ct"))
          assertEquals(3, whiteState.getInt("bri"))
        } else {
          darkSeen = true
          assertFalse(colorState.has("ct"))
          assertFalse(whiteState.has("ct"))
        }
        excluded.forEach { lamp ->
          val state = supportedPresetState(sequence, lamp, step, settings)
          listOf("ct", "hue", "sat", "xy").forEach { assertFalse(state.has(it)) }
          if (lamp.getString("kind") == "onoff-plug") {
            assertEquals(setOf("on"), state.keys().asSequence().toSet())
            assertEquals(sequence != "halloween-storm" || !step.quiet, state.getBoolean("on"))
          } else {
            assertEquals(step.state.getBoolean("on"), state.getBoolean("on"))
            assertEquals(step.state.opt("bri"), state.opt("bri"))
          }
        }
        val keep = settings.copy(whiteColor = AmbianceColor.Keep, glowWhiteColor = AmbianceColor.Keep)
        assertFalse(supportedPresetState(sequence, white, step, keep).has("ct"))
        assertFalse(supportedPresetState(sequence, white, step).has("ct"))
        previous = step
      }
      if (sequence == "halloween-storm") {
        assertTrue(glowSeen)
        assertTrue(darkSeen)
      }
    }
  }

  @Test fun acceptsInclusiveColorAndBrightnessBoundaries() {
    listOf(1, 100).forEach { brightness ->
      listOf(2000, 6500).forEach { temperature ->
        val settings = settingsJson().put("minBrightness", brightness).put("maxBrightness", brightness)
          .put("color", JSONObject().put("mode", "white").put("temperature", temperature))
        assertEquals(AmbianceColor.White(temperature),
          AmbianceSpec.parse(JSONObject(request).put("settings", settings).toString()).settings.color)
      }
    }
    assertEquals(AmbianceColor.Color(0, 0), AmbianceColor.parse(JSONObject("""{"mode":"color","hue":0,"saturation":0}""")))
  }

  @Test fun rejectsUnknownSequencesUnavailableLightsAndInvalidCredentials() {
    listOf(
      request.replace("candlelight", "unknown"),
      request.replace("\"1\",\"1\",\"2\"", "\"3\""),
      request.replace("placeholder", "key/path"),
      request.replace("bridge.local", "bridge.local/extra")
    ).forEach { json ->
      assertThrows(IllegalArgumentException::class.java) { AmbianceSpec.parse(json) }
    }
  }

  @Test fun audioOnlyTimelinesAndTheirVolumesArePreserved() {
    val json = JSONObject(request)
    json.getJSONObject("description").put("sequenceId", "saved")
    json.put("timeline", JSONObject("""{
      "durationMs":1000,"events":[],
      "audio":[{"id":"fx","uri":"file://clip.wav","atMs":500,"durationMs":250,"volume":0}]
    }"""))
    val spec = AmbianceSpec.parse(json.toString())
    assertEquals(1, spec.audio.size)
    assertEquals(0.0, spec.audio.single().getDouble("volume"), 0.0)
    assertEquals(1000L, spec.timeline!!.getLong("durationMs"))
    json.getJSONObject("timeline").getJSONArray("audio").getJSONObject(0).put("atMs", 1000)
    assertThrows(IllegalArgumentException::class.java) { AmbianceSpec.parse(json.toString()) }
  }

  @Test fun cumulativeStateRetainsBrightnessAndReplacesConflictingColorModes() {
    var state = accumulatedState(null, JSONObject("""{"on":true,"bri":100,"hue":45000,"sat":200}"""))
    state = accumulatedState(state, JSONObject("""{"on":true,"bri":50}"""))
    assertEquals(45000, state.getInt("hue"))
    state = accumulatedState(state, JSONObject("""{"ct":455}"""))
    assertFalse(state.has("hue"))
    assertFalse(state.has("sat"))
    assertEquals(50, state.getInt("bri"))
    state = accumulatedState(state, JSONObject("""{"xy":[0.4,0.3]}"""))
    assertFalse(state.has("ct"))
    state = accumulatedState(state, JSONObject("""{"hue":100,"sat":254}"""))
    assertFalse(state.has("xy"))
    assertEquals(100, state.getInt("hue"))
    assertEquals(50, state.getInt("bri"))
  }

  @Test fun candlelightMeetsExistingBrightnessTimingAndTransitionBounds() {
    val random = Random(42)
    var previous: PresetStep? = null
    repeat(10000) {
      val step = presetStep("candlelight", previous, random)
      assertTrue(step.durationMs in 600..2000)
      assertTrue(step.brightness in 8..50)
      assertTrue(step.state.getInt("transitiontime") in 2..8)
      assertTrue(step.state.getInt("transitiontime") * 100 <= step.durationMs)
      assertEquals(455, step.state.getInt("ct"))
      assertTrue(step.state.getBoolean("on"))
      previous = step
    }
  }

  @Test fun stormAlternatesQuietAndBurstWithCapabilitySpecificStates() {
    val random = Random(9)
    var previous: PresetStep? = null
    var glowSeen = false
    var darknessSeen = false
    val plug = JSONObject("""{"kind":"onoff-plug","colorTemperatureCapable":false}""")
    val dimmer = JSONObject("""{"kind":"dimmable","colorTemperatureCapable":false}""")
    val white = JSONObject("""{"kind":"tunable-white","colorTemperatureCapable":true}""")
    val rgb = JSONObject("""{"kind":"color","colorTemperatureCapable":true,"colorCapable":true}""")
    repeat(10000) { index ->
      val step = presetStep("halloween-storm", previous, random)
      if (index % 2 == 0) {
        assertTrue(step.quiet)
        assertTrue(step.durationMs in 4000..18000)
        glowSeen = glowSeen || step.brightness == 1
        darknessSeen = darknessSeen || step.brightness == 0
        assertFalse(supportedPresetState("halloween-storm", plug, step).getBoolean("on"))
      } else {
        assertFalse(step.quiet)
        assertTrue(step.durationMs in 1000..3000)
        assertTrue(step.brightness in 80..100)
        assertEquals(154, supportedPresetState("halloween-storm", rgb, step).getInt("ct"))
        assertTrue(supportedPresetState("halloween-storm", plug, step).getBoolean("on"))
      }
      assertFalse(supportedPresetState("halloween-storm", dimmer, step).has("ct"))
      assertFalse(supportedPresetState("halloween-storm", white, step).has("ct"))
      assertFalse(supportedPresetState("halloween-storm", plug, step).has("bri"))
      previous = step
    }
    assertTrue(glowSeen)
    assertTrue(darknessSeen)
  }

  @Test fun configuredRangesPreserveSmoothingTimingAndHueBrightnessConversion() {
    val random = Random(123)
    listOf(1..1, 100..100, 23..29, 1..100).forEach { range ->
      val settings = AmbianceSettings(range.first, range.last, AmbianceColor.Keep, AmbianceColor.Keep)
      listOf("candlelight", "halloween-storm").forEach { sequence ->
        var previous: PresetStep? = null
        repeat(1000) {
          val step = presetStep(sequence, previous, random, settings)
          if (!step.quiet) {
            assertTrue(step.brightness in range)
            assertEquals((step.brightness * 2.54).roundToInt(), step.state.getInt("bri"))
            assertTrue(step.state.getInt("bri") in 1..254)
          }
          assertFalse(step.state.has("ct"))
          assertFalse(step.state.has("hue"))
          assertFalse(step.state.has("sat"))
          if (sequence == "candlelight") {
            assertTrue(step.durationMs in 600..2000)
            assertTrue(step.state.getInt("transitiontime") in 2..8)
            assertFalse(step.quiet)
          } else {
            assertTrue(if (step.quiet) step.durationMs in 4000..18000 else step.durationMs in 1000..3000)
          }
          previous = step
        }
      }
    }
    val seed = 43
    val target = Random(seed).nextInt(20, 81)
    val previous = PresetStep(JSONObject(), 1000, 20, false)
    val step = presetStep("candlelight", previous, Random(seed),
      AmbianceSettings(20, 80, AmbianceColor.Keep, AmbianceColor.Keep))
    assertEquals((target * 0.85 + 20 * 0.15).roundToInt(), step.brightness)
  }

  @Test fun configuredColorsAreAppliedOnlyToRgbLampsAndStormUsesSeparateGlow() {
    val random = Random(17)
    val settings = AmbianceSettings(20, 30, AmbianceColor.Color(12345, 67), AmbianceColor.White(4000))
    val rgb = JSONObject("""{"kind":"color","colorCapable":true,"colorTemperatureCapable":false}""")
    val nonRgb = listOf(
      """{"kind":"dimmable","colorCapable":false,"colorTemperatureCapable":false}""",
      """{"kind":"tunable-white","colorCapable":false,"colorTemperatureCapable":true}""",
      """{"kind":"dimmable-plug","colorCapable":false,"colorTemperatureCapable":false}""",
      """{"kind":"color","colorCapable":false,"colorTemperatureCapable":true}"""
    ).map(::JSONObject)
    var previous: PresetStep? = null
    var glowSeen = false
    repeat(1000) {
      val step = presetStep("halloween-storm", previous, random, settings)
      val colorState = supportedPresetState("halloween-storm", rgb, step)
      if (!step.quiet) {
        assertEquals(12345, colorState.getInt("hue"))
        assertEquals(67, colorState.getInt("sat"))
        assertFalse(colorState.has("ct"))
      } else if (step.brightness == 1) {
        glowSeen = true
        assertEquals(250, colorState.getInt("ct"))
        assertEquals(3, colorState.getInt("bri"))
        assertFalse(colorState.has("hue"))
      }
      nonRgb.forEach { lamp ->
        val state = supportedPresetState("halloween-storm", lamp, step)
        listOf("ct", "hue", "sat", "xy").forEach { assertFalse(state.has(it)) }
        assertEquals(step.state.getBoolean("on"), state.getBoolean("on"))
        if (step.state.has("bri")) assertEquals(step.state.getInt("bri"), state.getInt("bri"))
      }
      previous = step
    }
    assertTrue(glowSeen)
    val candle = presetStep("candlelight", null, random, settings.copy(color = AmbianceColor.White(6500)))
    assertEquals(154, supportedPresetState("candlelight", rgb, candle).getInt("ct"))
    nonRgb.forEach { assertFalse(supportedPresetState("candlelight", it, candle).has("ct")) }
    val coloredGlow = settings.copy(color = AmbianceColor.Keep, glowColor = AmbianceColor.Color(0, 254))
    previous = null
    glowSeen = false
    repeat(100) {
      val step = presetStep("halloween-storm", previous, random, coloredGlow)
      if (step.quiet && step.brightness == 1) {
        glowSeen = true
        assertEquals(0, step.state.getInt("hue"))
        assertEquals(254, step.state.getInt("sat"))
        assertFalse(step.state.has("ct"))
      } else {
        assertFalse(step.state.has("hue"))
        assertFalse(step.state.has("sat"))
      }
      previous = step
    }
    assertTrue(glowSeen)
  }

  @Test fun onoffCandleStaysOnAndOnePercentStormBurstsStayOnButAllQuietStepsTurnOff() {
    val random = Random(8)
    val plug = JSONObject("""{"kind":"onoff-plug","colorCapable":false}""")
    val settings = AmbianceSettings(1, 1, AmbianceColor.Color(0, 0), AmbianceColor.White(2200))
    var previous: PresetStep? = null
    repeat(1000) {
      val candle = presetStep("candlelight", null, random, settings)
      val candleState = supportedPresetState("candlelight", plug, candle)
      assertEquals(setOf("on"), candleState.keys().asSequence().toSet())
      assertTrue(candleState.getBoolean("on"))
      val storm = presetStep("halloween-storm", previous, random, settings)
      val stormState = supportedPresetState("halloween-storm", plug, storm)
      assertEquals(setOf("on"), stormState.keys().asSequence().toSet())
      assertEquals(!storm.quiet, stormState.getBoolean("on"))
      if (!storm.quiet) assertEquals(1, storm.brightness)
      previous = storm
    }
  }
}
