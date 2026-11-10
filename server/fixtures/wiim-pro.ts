// Answers recorded on a WiiM Pro (firmware `Linkplay.4.8.833748`, release
// `20261027`) through `GET /httpapi.asp?command=…`, on 2026-11-09.
//
// Every answer is kept as the transport returns it: one string, keys and value
// types untouched, `\/` escapes included. That is the shape `fetchCommand` hands
// to the parsers, and the shape that used to hide bugs (a counter sent as a
// number, a title sent as hex, `Failed` instead of `unknown command`).
//
// Sanitized: MAC addresses, BSSIDs, uuids, the device and network names, and the
// player address. The shapes are the firmware's; only the identities changed.
//
// The answers below feed the pure seams (`parseDevice` in `device/index.ts`, then
// `parseCapability`, `parsePresets`, `parseRegistry` and `parseAcoustic`); the
// transport, the caches and the retries stay in `device/`, exercised end to end by
// the Playwright run against the demo.

// getStatusEx: everything is a string, the network name is hex (`essid`), and
// the device reports both `RSSI` and the link counters.
export const statusEx = String.raw`{ "language": "fr-FR", "ssid": "WiiM Pro-DEMO", "hideSSID": "0", "firmware": "Linkplay.4.8.833748", "build": "release", "project": "WiiM_Pro_with_gc4a", "priv_prj": "WiiM_Pro_with_gc4a", "project_build_name": "WiiM_Pro_with_gc4a", "Release": "20261027", "FW_Release_version": "", "PCB_version": "2", "cast_enable": 1, "cast_usage_report": 1, "group": "0", "wmrm_version": "4.3", "wmrm_sub_ver": "7", "wmrm_capability": 63, "expired": "0", "internet": "1", "uuid": "A1B2C3D4E5F60718293A4B5C", "MAC": "02:00:00:00:00:01", "BTMAC": "02:00:00:00:00:02", "InitialConfiguration": "1", "AP_MAC": "02:00:00:00:00:03", "date": "2026:11:09", "time": "13:49:12", "netstat": "2", "essid": "486F6D654E65742D3547", "apcli0": "192.0.2.150", "eth0": "0.0.0.0", "eth2": "0.0.0.0", "ETH_MAC": "02:00:00:00:00:04", "hardware": "AmlogicA113", "ota_api_ver": "3.0", "VersionUpdate": "0", "NewVer": "0", "mcu_ver": "0", "mcu_ver_new": "0", "update_check_count": "8", "BleRemote_update_checked_counter": "0", "ra0": "10.10.10.254", "temp_uuid": "0123456789ABCDEF", "cap1": "0x40000400", "capability": "0x20084808", "languages": "0x11ec", "prompt_status": "1", "alexa_ver": "20180604", "alexa_beta_enable": "0", "alexa_force_beta_cfg": "0", "dsp_ver": "", "ModuleColorNumber": "0", "ModuleColorString": "", "ble_active": "0", "dsp_ver_new": "", "uboot_verinfo": "", "kernel_verinfo": "#1 SMP PREEMPT Tue Jul 14 17:16:18 CST 2026", "silence_ota_flag": "0", "ota_interface_ver": "2.0", "streams_all": "0xedf33fd", "streams": "0xedf33fd", "region": "unknown", "volume_control": "0", "external": "0x0", "preset_key": "12", "plm_support": "0x700016", "mqtt_support": "1", "lbc_support": "0", "WifiChannel": "0", "RSSI": "-51", "BSSID": "02:00:00:00:00:05", "wlanSnr": "35", "wlanNoise": "-91", "wlanFreq": "5260", "wlanDataRate": "433", "battery": "0", "battery_percent": "0", "securemode": "1", "upnp_version": "1005", "upnp_uuid": "uuid:A1B2C3D4-E5F6-0718-293A-4B5CA1B2C3D4", "uart_pass_port": "0", "communication_port": "8819", "web_firmware_update_hide": "0", "new_tunein_preset_and_alarm": "1", "new_iheart_podcast": "1", "tidal_version": "2.0", "service_version": "1.0", "HiFiSRC_version": "1.1", "EQ_support": "Eq10HP_ver_2.0", "EQVersion": "4.3", "audio_channel_config": "1.0", "app_timezone_id": "Europe\/Paris", "avs_timezone_id": "Europe\/Paris", "tz_info_ver": "1.0", "tz": "1.0", "max_volume": "100", "power_mode": "-1", "security": "https\/2.0", "security_version": "3.0", "security_capabilities": { "ver": "1.0", "aes_ver": "1.0" }, "public_https_version": "1.0", "BleRemoteControl": "1", "BleRemoteConnected": "0", "BleRemoteException": "0", "autoSenseVersion": "1.0", "audiocast": "1", "set_play_mode_enable": "1", "set_play_mode_gain": "0", "audioOutputModeVer": "1.0", "deviceSettingVer": "0.0", "privacy_mode": "0", "DeviceName": "Living Room", "GroupName": "Living Room" }`

// getPlayerStatusEx: the same track is also sent as hex (`Title`, `Album`), and
// a stopped AirPlay cast still carries the last position.
export const playerStatusEx =
  '{"type":"0","ch":"0","mode":"5","loop":"0","eq":"0","vendor":"CAST","status":"stop","curpos":"49489","offset_pts":"24148","totlen":"123000","Title":"476F676F6C","Artist":"","Album":"536F6C6F205069616E6F","alarmflag":"0","plicount":"0","plicurr":"0","vol":"81","mute":"0"}'

// getMetaInfo: `title` is plain text, the codec numbers are unknown for this
// source and answered with the placeholder `unknow`.
export const metaInfo =
  '{ "metaData": { "album": "Solo Piano", "title": "Gogol", "subtitle": "unknow", "artist": "Chilly Gonzales", "albumArtURI": "https://yt3.googleusercontent.com/QA7o7qaROZVzjlyXtZFX_mp_2Cg_xRgLMnzuSAlrbjS95esjV-8MiF1W52hiins_t-G-uGSwlN0GvHV6=w544-h544-l90-rj", "sampleRate": "48000", "bitDepth": "unknow", "bitRate": "unknow", "trackId": "0" } }'

// getNewAudioOutputHardwareMode: `2` is the line output of the vendor table.
export const outputMode = '{"hardware":"2","source":"0","audiocast":"0"}'

// getShutdown: a bare number, zero when no sleep timer is armed.
export const shutdown = '0'

export const inputCapability =
  '{ "ver": "1.0", "audioInput": [ { "mode": "wifi" }, { "mode": "line-in" }, { "mode": "bluetooth" }, { "mode": "optical" } ] }'

export const inputEnable =
  '{ "ver": "1.0", "audioInput": [ { "mode": "wifi", "enable": 1 }, { "mode": "bluetooth", "enable": 1 }, { "mode": "line-in", "enable": 1 }, { "mode": "optical", "enable": 1 } ] }'

// getModeRename: this model does not rename inputs at all and answers `Failed`,
// which is neither JSON nor an `unknown command` marker.
export const modeRename = 'Failed'

export const outputList =
  '[ { "index": 1, "mode": "AUDIO_OUTPUT_SPDIF_MODE", "soundCard": { "cardName": "AMLAUGESOUND", "devName": "Optical Out", "cardId": "hw:0,4" } }, { "index": 2, "mode": "AUDIO_OUTPUT_AUX_MODE", "soundCard": { "cardName": "AMLAUGESOUND", "devName": "Line Out", "cardId": "hw:0,1" } }, { "index": 3, "mode": "AUDIO_OUTPUT_COAX_MODE", "soundCard": { "cardName": "AMLAUGESOUND", "devName": "COAX Out", "cardId": "hw:0,4" } } ]'

// EQGetList: the factory curve names, as a bare JSON array.
export const eqList =
  '[ "Flat", "Acoustic", "Bass Booster", "Bass Reducer", "Classical", "Dance", "Deep", "Electronic", "Game", "Hip-Hop", "Jazz", "Latin", "Loudness", "Lounge", "Movie", "Piano", "Pop", "R&B", "Rock", "Small Speakers", "Spoken Word", "Treble Booster", "Treble Reducer", "Vocal Booster" ]'

// GetAcousticCapability: `RC` is what unlocks room correction.
export const acousticCapability =
  '{"Version":"1.0","GEQ":{"Version":"1.0"},"PEQ":{"Version":"1.0","Filters":["OFF","LS","PK","HS","LP","HP"]},"RC":{"Version":"1.0"},"EQHeadroom":{"Version":"1.0","Modes":["Off","Auto","Manual"]},"SubLPF":{"Version":"1.0"},"Evaluation":{"Version":"1.1"},"EQBlock":{"Version":"1.0","Blocks":[{"id":1,"type":"EQ"},{"id":2,"type":"RC"}]},"OutputDelay":{"Version":"1.0","PerOutputDelay":false,"EnableMicroDelay":true,"MinDelayUs":-1000000,"MaxDelayUs":1000000,"StepDelayUs":100}}'

// EQGetLV2SourceBandEx: the curve is per source, the answer names the source it
// came from, and `EQStat` is `Off` while a curve name is still remembered.
export const eqBands =
  '{"status":"OK","EQLevel":1,"source_name":"wifi","EQStat":"Off","Name":"Rock","pluginURI":"http://moddevices.com/plugins/caps/Eq10HP","channelMode":"Stereo","EQBand":[{"index":0,"param_name":"band31hz","value":5.000},{"index":1,"param_name":"band63hz","value":4.000},{"index":2,"param_name":"band125hz","value":3.000},{"index":3,"param_name":"band250hz","value":1.500},{"index":4,"param_name":"band500hz","value":-0.500},{"index":5,"param_name":"band1khz","value":-1.000},{"index":6,"param_name":"band2khz","value":0.500},{"index":7,"param_name":"band4khz","value":2.500},{"index":8,"param_name":"band8khz","value":3.500},{"index":9,"param_name":"band16khz","value":1.500}]}'

// multiroom:getSlaveList: a master with no follower answers a lowercase count,
// the documented `Slave_list` key is absent.
export const slaveList = '{ "slaves": 0, "wmrm_version": "4.3", "surround": 0, "group_type": 0 }'

// multiroom:getnamegrouplist: the registry keeps a saved group the running
// player is not part of, and its member is offline (no `ip` at all).
export const savedGroups =
  '{ "grouplist": [ { "group_name": "Apartment", "group_id": "11111111-2222-3333-4444-555555555555", "group_type": 0, "channel": -1, "update_time": "1794151643", "slavelist": [ { "name": "Bedroom", "uuid": "A1B2C3D4E5F60718293A4B5C", "channel": -1 } ] } ], "current_group_id": "11111111-2222-3333-4444-555555555555" }'

// getPresetInfo: an empty slot list, not an absent one.
export const presetInfo = '{ "preset_num": 0, "preset_list": [ ] }'

// streamServicesCapability: every service this firmware can drive, with the
// quality levels it publishes for it. The shapes are not uniform on purpose: a
// ladder of names, a vendor enum (Qobuz lists format ids), bitrates, codec
// tokens, and nothing at all for the endpoints where the vendor app decides.
export const streamServices = `{ "version": "1.6", "encrypt": "1.0", "streamServices": [ { "id": "Prime", "version": "1.4", "quality": [ "SD", "HD", "UHD" ] }, { "id": "Tidal", "version": "2.3", "quality": [ "LOW", "HIGH", "LOSSLESS", "HI_RES" ], "replayGain": true }, { "id": "newTuneIn", "version": "1.2" }, { "id": "Rhapsody", "version": "1.1" }, { "id": "SoundMachine", "version": "1.2" }, { "id": "Deezer2", "version": "1.1", "quality": [ "LOW", "MEDIUM", "HIGH", "LOSSLESS" ], "brand": "WiiM", "hw": "WiiM Pro" }, { "id": "Qobuz", "version": "2.2", "quality": [ "5", "6", "7", "27" ], "replayGain": true }, { "id": "iHeartRadio", "version": "1.0" }, { "id": "iHeart", "version": "1.0" }, { "id": "Pandora2", "version": "1.1", "quality": [ "Low", "Medium", "High" ] }, { "id": "vTuner", "version": "1.1" }, { "id": "CalmRadio", "version": "1.1", "quality": [ "64", "128", "192", "320" ] }, { "id": "SoundCloud", "version": "1.3" }, { "id": "Plex", "version": "1.4", "replayGain": true }, { "id": "KKBOX", "version": "1.0", "quality": [ "aac_320_dash_cenc", "flac_16_dash_cenc", "flac_24_dash_cenc" ] }, { "id": "RadioParadise2", "version": "1.0" }, { "id": "HotMix", "version": "1.0" }, { "id": "WiiMRadio", "version": "1.0" }, { "id": "SpotifyConnect", "version": "1.3", "configurable": true, "active": true }, { "id": "TidalConnect", "version": "1.0", "configurable": true, "active": false }, { "id": "AVS_MRM", "version": "1.0", "configurable": true, "active": true }, { "id": "Squeezelite", "version": "1.3", "configurable": true, "active": false }, { "id": "Roon", "version": "1.0", "configurable": true, "active": false }, { "id": "Soundtrack", "version": "1.1", "configurable": true, "active": false }, { "id": "QobuzConnect", "version": "1.0", "configurable": true, "active": false }, { "id": "AudioCast", "version": "1.0", "configurable": true, "active": false }, { "id": "Samba", "version": "1.0" }, { "id": "YouTubeMusic", "version": "1.0", "brand": "WiiM", "model": "Pro" }, { "id": "Presto", "version": "1.0" } ] }`
