// ==UserScript==
// @name         Tripo 3D 模型录屏旋转助手
// @namespace    codex.tripo.rotation
// @version      3.9.2
// @description  支持固定帧 MP4、透明 MOV/PNG、线框叉乘和独立明亮白膜效果的 Tripo Studio 模型旋转与转场助手。
// @author       Codex
// @license      MIT
// @homepageURL  https://github.com/Ben8368/tripo-model-rotation
// @supportURL   https://github.com/Ben8368/tripo-model-rotation/issues
// @updateURL    https://raw.githubusercontent.com/Ben8368/tripo-model-rotation/master/tripo-model-rotation.user.js
// @downloadURL  https://raw.githubusercontent.com/Ben8368/tripo-model-rotation/master/tripo-model-rotation.user.js
// @match        https://studio.tripo3d.ai/workspace/generate
// @match        https://studio.tripo3d.ai/workspace/generate/*
// @match        https://studio.tripo3d.ai/*/workspace/generate
// @match        https://studio.tripo3d.ai/*/workspace/generate/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

;(function () {
  'use strict';

  // Bundled mp4-muxer 5.2.2. Keeping the encoder dependency inside this
  // userscript makes installation reproducible and avoids runtime CDN trust.
  // The generated bundle is inserted immediately after this marker.
"use strict";
var Mp4Muxer = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __accessCheck = (obj, member, msg) => {
    if (!member.has(obj))
      throw TypeError("Cannot " + msg);
  };
  var __privateGet = (obj, member, getter) => {
    __accessCheck(obj, member, "read from private field");
    return getter ? getter.call(obj) : member.get(obj);
  };
  var __privateAdd = (obj, member, value) => {
    if (member.has(obj))
      throw TypeError("Cannot add the same private member more than once");
    member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
  };
  var __privateSet = (obj, member, value, setter) => {
    __accessCheck(obj, member, "write to private field");
    setter ? setter.call(obj, value) : member.set(obj, value);
    return value;
  };
  var __privateWrapper = (obj, member, setter, getter) => ({
    set _(value) {
      __privateSet(obj, member, value, setter);
    },
    get _() {
      return __privateGet(obj, member, getter);
    }
  });
  var __privateMethod = (obj, member, method) => {
    __accessCheck(obj, member, "access private method");
    return method;
  };

  // src/index.ts
  var src_exports = {};
  __export(src_exports, {
    ArrayBufferTarget: () => ArrayBufferTarget,
    FileSystemWritableFileStreamTarget: () => FileSystemWritableFileStreamTarget,
    Muxer: () => Muxer,
    StreamTarget: () => StreamTarget
  });

  // src/misc.ts
  var bytes = new Uint8Array(8);
  var view = new DataView(bytes.buffer);
  var u8 = (value) => {
    return [(value % 256 + 256) % 256];
  };
  var u16 = (value) => {
    view.setUint16(0, value, false);
    return [bytes[0], bytes[1]];
  };
  var i16 = (value) => {
    view.setInt16(0, value, false);
    return [bytes[0], bytes[1]];
  };
  var u24 = (value) => {
    view.setUint32(0, value, false);
    return [bytes[1], bytes[2], bytes[3]];
  };
  var u32 = (value) => {
    view.setUint32(0, value, false);
    return [bytes[0], bytes[1], bytes[2], bytes[3]];
  };
  var i32 = (value) => {
    view.setInt32(0, value, false);
    return [bytes[0], bytes[1], bytes[2], bytes[3]];
  };
  var u64 = (value) => {
    view.setUint32(0, Math.floor(value / 2 ** 32), false);
    view.setUint32(4, value, false);
    return [bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7]];
  };
  var fixed_8_8 = (value) => {
    view.setInt16(0, 2 ** 8 * value, false);
    return [bytes[0], bytes[1]];
  };
  var fixed_16_16 = (value) => {
    view.setInt32(0, 2 ** 16 * value, false);
    return [bytes[0], bytes[1], bytes[2], bytes[3]];
  };
  var fixed_2_30 = (value) => {
    view.setInt32(0, 2 ** 30 * value, false);
    return [bytes[0], bytes[1], bytes[2], bytes[3]];
  };
  var ascii = (text, nullTerminated = false) => {
    let bytes2 = Array(text.length).fill(null).map((_, i) => text.charCodeAt(i));
    if (nullTerminated)
      bytes2.push(0);
    return bytes2;
  };
  var last = (arr) => {
    return arr && arr[arr.length - 1];
  };
  var lastPresentedSample = (samples) => {
    let result = void 0;
    for (let sample of samples) {
      if (!result || sample.presentationTimestamp > result.presentationTimestamp) {
        result = sample;
      }
    }
    return result;
  };
  var intoTimescale = (timeInSeconds, timescale, round = true) => {
    let value = timeInSeconds * timescale;
    return round ? Math.round(value) : value;
  };
  var rotationMatrix = (rotationInDegrees) => {
    let theta = rotationInDegrees * (Math.PI / 180);
    let cosTheta = Math.cos(theta);
    let sinTheta = Math.sin(theta);
    return [
      cosTheta,
      sinTheta,
      0,
      -sinTheta,
      cosTheta,
      0,
      0,
      0,
      1
    ];
  };
  var IDENTITY_MATRIX = rotationMatrix(0);
  var matrixToBytes = (matrix) => {
    return [
      fixed_16_16(matrix[0]),
      fixed_16_16(matrix[1]),
      fixed_2_30(matrix[2]),
      fixed_16_16(matrix[3]),
      fixed_16_16(matrix[4]),
      fixed_2_30(matrix[5]),
      fixed_16_16(matrix[6]),
      fixed_16_16(matrix[7]),
      fixed_2_30(matrix[8])
    ];
  };
  var deepClone = (x) => {
    if (!x)
      return x;
    if (typeof x !== "object")
      return x;
    if (Array.isArray(x))
      return x.map(deepClone);
    return Object.fromEntries(Object.entries(x).map(([key, value]) => [key, deepClone(value)]));
  };
  var isU32 = (value) => {
    return value >= 0 && value < 2 ** 32;
  };

  // src/box.ts
  var box = (type, contents, children) => ({
    type,
    contents: contents && new Uint8Array(contents.flat(10)),
    children
  });
  var fullBox = (type, version, flags, contents, children) => box(
    type,
    [u8(version), u24(flags), contents ?? []],
    children
  );
  var ftyp = (details) => {
    let minorVersion = 512;
    if (details.fragmented)
      return box("ftyp", [
        ascii("iso5"),
        // Major brand
        u32(minorVersion),
        // Minor version
        // Compatible brands
        ascii("iso5"),
        ascii("iso6"),
        ascii("mp41")
      ]);
    return box("ftyp", [
      ascii("isom"),
      // Major brand
      u32(minorVersion),
      // Minor version
      // Compatible brands
      ascii("isom"),
      details.holdsAvc ? ascii("avc1") : [],
      ascii("mp41")
    ]);
  };
  var mdat = (reserveLargeSize) => ({ type: "mdat", largeSize: reserveLargeSize });
  var free = (size) => ({ type: "free", size });
  var moov = (tracks, creationTime, fragmented = false) => box("moov", null, [
    mvhd(creationTime, tracks),
    ...tracks.map((x) => trak(x, creationTime)),
    fragmented ? mvex(tracks) : null
  ]);
  var mvhd = (creationTime, tracks) => {
    let duration = intoTimescale(Math.max(
      0,
      ...tracks.filter((x) => x.samples.length > 0).map((x) => {
        const lastSample = lastPresentedSample(x.samples);
        return lastSample.presentationTimestamp + lastSample.duration;
      })
    ), GLOBAL_TIMESCALE);
    let nextTrackId = Math.max(...tracks.map((x) => x.id)) + 1;
    let needsU64 = !isU32(creationTime) || !isU32(duration);
    let u32OrU64 = needsU64 ? u64 : u32;
    return fullBox("mvhd", +needsU64, 0, [
      u32OrU64(creationTime),
      // Creation time
      u32OrU64(creationTime),
      // Modification time
      u32(GLOBAL_TIMESCALE),
      // Timescale
      u32OrU64(duration),
      // Duration
      fixed_16_16(1),
      // Preferred rate
      fixed_8_8(1),
      // Preferred volume
      Array(10).fill(0),
      // Reserved
      matrixToBytes(IDENTITY_MATRIX),
      // Matrix
      Array(24).fill(0),
      // Pre-defined
      u32(nextTrackId)
      // Next track ID
    ]);
  };
  var trak = (track, creationTime) => box("trak", null, [
    tkhd(track, creationTime),
    mdia(track, creationTime)
  ]);
  var tkhd = (track, creationTime) => {
    let lastSample = lastPresentedSample(track.samples);
    let durationInGlobalTimescale = intoTimescale(
      lastSample ? lastSample.presentationTimestamp + lastSample.duration : 0,
      GLOBAL_TIMESCALE
    );
    let needsU64 = !isU32(creationTime) || !isU32(durationInGlobalTimescale);
    let u32OrU64 = needsU64 ? u64 : u32;
    let matrix;
    if (track.info.type === "video") {
      matrix = typeof track.info.rotation === "number" ? rotationMatrix(track.info.rotation) : track.info.rotation;
    } else {
      matrix = IDENTITY_MATRIX;
    }
    return fullBox("tkhd", +needsU64, 3, [
      u32OrU64(creationTime),
      // Creation time
      u32OrU64(creationTime),
      // Modification time
      u32(track.id),
      // Track ID
      u32(0),
      // Reserved
      u32OrU64(durationInGlobalTimescale),
      // Duration
      Array(8).fill(0),
      // Reserved
      u16(0),
      // Layer
      u16(0),
      // Alternate group
      fixed_8_8(track.info.type === "audio" ? 1 : 0),
      // Volume
      u16(0),
      // Reserved
      matrixToBytes(matrix),
      // Matrix
      fixed_16_16(track.info.type === "video" ? track.info.width : 0),
      // Track width
      fixed_16_16(track.info.type === "video" ? track.info.height : 0)
      // Track height
    ]);
  };
  var mdia = (track, creationTime) => box("mdia", null, [
    mdhd(track, creationTime),
    hdlr(track.info.type === "video" ? "vide" : "soun"),
    minf(track)
  ]);
  var mdhd = (track, creationTime) => {
    let lastSample = lastPresentedSample(track.samples);
    let localDuration = intoTimescale(
      lastSample ? lastSample.presentationTimestamp + lastSample.duration : 0,
      track.timescale
    );
    let needsU64 = !isU32(creationTime) || !isU32(localDuration);
    let u32OrU64 = needsU64 ? u64 : u32;
    return fullBox("mdhd", +needsU64, 0, [
      u32OrU64(creationTime),
      // Creation time
      u32OrU64(creationTime),
      // Modification time
      u32(track.timescale),
      // Timescale
      u32OrU64(localDuration),
      // Duration
      u16(21956),
      // Language ("und", undetermined)
      u16(0)
      // Quality
    ]);
  };
  var hdlr = (componentSubtype) => fullBox("hdlr", 0, 0, [
    ascii("mhlr"),
    // Component type
    ascii(componentSubtype),
    // Component subtype
    u32(0),
    // Component manufacturer
    u32(0),
    // Component flags
    u32(0),
    // Component flags mask
    ascii("mp4-muxer-hdlr", true)
    // Component name
  ]);
  var minf = (track) => box("minf", null, [
    track.info.type === "video" ? vmhd() : smhd(),
    dinf(),
    stbl(track)
  ]);
  var vmhd = () => fullBox("vmhd", 0, 1, [
    u16(0),
    // Graphics mode
    u16(0),
    // Opcolor R
    u16(0),
    // Opcolor G
    u16(0)
    // Opcolor B
  ]);
  var smhd = () => fullBox("smhd", 0, 0, [
    u16(0),
    // Balance
    u16(0)
    // Reserved
  ]);
  var dinf = () => box("dinf", null, [
    dref()
  ]);
  var dref = () => fullBox("dref", 0, 0, [
    u32(1)
    // Entry count
  ], [
    url()
  ]);
  var url = () => fullBox("url ", 0, 1);
  var stbl = (track) => {
    const needsCtts = track.compositionTimeOffsetTable.length > 1 || track.compositionTimeOffsetTable.some((x) => x.sampleCompositionTimeOffset !== 0);
    return box("stbl", null, [
      stsd(track),
      stts(track),
      stss(track),
      stsc(track),
      stsz(track),
      stco(track),
      needsCtts ? ctts(track) : null
    ]);
  };
  var stsd = (track) => fullBox("stsd", 0, 0, [
    u32(1)
    // Entry count
  ], [
    track.info.type === "video" ? videoSampleDescription(
      VIDEO_CODEC_TO_BOX_NAME[track.info.codec],
      track
    ) : soundSampleDescription(
      AUDIO_CODEC_TO_BOX_NAME[track.info.codec],
      track
    )
  ]);
  var videoSampleDescription = (compressionType, track) => box(compressionType, [
    Array(6).fill(0),
    // Reserved
    u16(1),
    // Data reference index
    u16(0),
    // Pre-defined
    u16(0),
    // Reserved
    Array(12).fill(0),
    // Pre-defined
    u16(track.info.width),
    // Width
    u16(track.info.height),
    // Height
    u32(4718592),
    // Horizontal resolution
    u32(4718592),
    // Vertical resolution
    u32(0),
    // Reserved
    u16(1),
    // Frame count
    Array(32).fill(0),
    // Compressor name
    u16(24),
    // Depth
    i16(65535)
    // Pre-defined
  ], [
    VIDEO_CODEC_TO_CONFIGURATION_BOX[track.info.codec](track),
    track.info.decoderConfig.colorSpace ? colr(track) : null
  ]);
  var COLOR_PRIMARIES_MAP = {
    "bt709": 1,
    // ITU-R BT.709
    "bt470bg": 5,
    // ITU-R BT.470BG
    "smpte170m": 6
    // ITU-R BT.601 525 - SMPTE 170M
  };
  var TRANSFER_CHARACTERISTICS_MAP = {
    "bt709": 1,
    // ITU-R BT.709
    "smpte170m": 6,
    // SMPTE 170M
    "iec61966-2-1": 13
    // IEC 61966-2-1
  };
  var MATRIX_COEFFICIENTS_MAP = {
    "rgb": 0,
    // Identity
    "bt709": 1,
    // ITU-R BT.709
    "bt470bg": 5,
    // ITU-R BT.470BG
    "smpte170m": 6
    // SMPTE 170M
  };
  var colr = (track) => box("colr", [
    ascii("nclx"),
    // Colour type
    u16(COLOR_PRIMARIES_MAP[track.info.decoderConfig.colorSpace.primaries]),
    // Colour primaries
    u16(TRANSFER_CHARACTERISTICS_MAP[track.info.decoderConfig.colorSpace.transfer]),
    // Transfer characteristics
    u16(MATRIX_COEFFICIENTS_MAP[track.info.decoderConfig.colorSpace.matrix]),
    // Matrix coefficients
    u8((track.info.decoderConfig.colorSpace.fullRange ? 1 : 0) << 7)
    // Full range flag
  ]);
  var avcC = (track) => track.info.decoderConfig && box("avcC", [
    // For AVC, description is an AVCDecoderConfigurationRecord, so nothing else to do here
    ...new Uint8Array(track.info.decoderConfig.description)
  ]);
  var hvcC = (track) => track.info.decoderConfig && box("hvcC", [
    // For HEVC, description is a HEVCDecoderConfigurationRecord, so nothing else to do here
    ...new Uint8Array(track.info.decoderConfig.description)
  ]);
  var vpcC = (track) => {
    if (!track.info.decoderConfig) {
      return null;
    }
    let decoderConfig = track.info.decoderConfig;
    if (!decoderConfig.colorSpace) {
      throw new Error(`'colorSpace' is required in the decoder config for VP9.`);
    }
    let parts = decoderConfig.codec.split(".");
    let profile = Number(parts[1]);
    let level = Number(parts[2]);
    let bitDepth = Number(parts[3]);
    let chromaSubsampling = 0;
    let thirdByte = (bitDepth << 4) + (chromaSubsampling << 1) + Number(decoderConfig.colorSpace.fullRange);
    let colourPrimaries = 2;
    let transferCharacteristics = 2;
    let matrixCoefficients = 2;
    return fullBox("vpcC", 1, 0, [
      u8(profile),
      // Profile
      u8(level),
      // Level
      u8(thirdByte),
      // Bit depth, chroma subsampling, full range
      u8(colourPrimaries),
      // Colour primaries
      u8(transferCharacteristics),
      // Transfer characteristics
      u8(matrixCoefficients),
      // Matrix coefficients
      u16(0)
      // Codec initialization data size
    ]);
  };
  var av1C = () => {
    let marker = 1;
    let version = 1;
    let firstByte = (marker << 7) + version;
    return box("av1C", [
      firstByte,
      0,
      0,
      0
    ]);
  };
  var soundSampleDescription = (compressionType, track) => box(compressionType, [
    Array(6).fill(0),
    // Reserved
    u16(1),
    // Data reference index
    u16(0),
    // Version
    u16(0),
    // Revision level
    u32(0),
    // Vendor
    u16(track.info.numberOfChannels),
    // Number of channels
    u16(16),
    // Sample size (bits)
    u16(0),
    // Compression ID
    u16(0),
    // Packet size
    fixed_16_16(track.info.sampleRate)
    // Sample rate
  ], [
    AUDIO_CODEC_TO_CONFIGURATION_BOX[track.info.codec](track)
  ]);
  var esds = (track) => {
    let description = new Uint8Array(track.info.decoderConfig.description);
    return fullBox("esds", 0, 0, [
      // https://stackoverflow.com/a/54803118
      u32(58753152),
      // TAG(3) = Object Descriptor ([2])
      u8(32 + description.byteLength),
      // length of this OD (which includes the next 2 tags)
      u16(1),
      // ES_ID = 1
      u8(0),
      // flags etc = 0
      u32(75530368),
      // TAG(4) = ES Descriptor ([2]) embedded in above OD
      u8(18 + description.byteLength),
      // length of this ESD
      u8(64),
      // MPEG-4 Audio
      u8(21),
      // stream type(6bits)=5 audio, flags(2bits)=1
      u24(0),
      // 24bit buffer size
      u32(130071),
      // max bitrate
      u32(130071),
      // avg bitrate
      u32(92307584),
      // TAG(5) = ASC ([2],[3]) embedded in above OD
      u8(description.byteLength),
      // length
      ...description,
      u32(109084800),
      // TAG(6)
      u8(1),
      // length
      u8(2)
      // data
    ]);
  };
  var dOps = (track) => {
    let preskip = 3840;
    let gain = 0;
    const description = track.info.decoderConfig?.description;
    if (description) {
      if (description.byteLength < 18) {
        throw new TypeError("Invalid decoder description provided for Opus; must be at least 18 bytes long.");
      }
      const view2 = ArrayBuffer.isView(description) ? new DataView(description.buffer, description.byteOffset, description.byteLength) : new DataView(description);
      preskip = view2.getUint16(10, true);
      gain = view2.getInt16(14, true);
    }
    return box("dOps", [
      u8(0),
      // Version
      u8(track.info.numberOfChannels),
      // OutputChannelCount
      u16(preskip),
      u32(track.info.sampleRate),
      // InputSampleRate
      fixed_8_8(gain),
      // OutputGain
      u8(0)
      // ChannelMappingFamily
    ]);
  };
  var stts = (track) => {
    return fullBox("stts", 0, 0, [
      u32(track.timeToSampleTable.length),
      // Number of entries
      track.timeToSampleTable.map((x) => [
        // Time-to-sample table
        u32(x.sampleCount),
        // Sample count
        u32(x.sampleDelta)
        // Sample duration
      ])
    ]);
  };
  var stss = (track) => {
    if (track.samples.every((x) => x.type === "key"))
      return null;
    let keySamples = [...track.samples.entries()].filter(([, sample]) => sample.type === "key");
    return fullBox("stss", 0, 0, [
      u32(keySamples.length),
      // Number of entries
      keySamples.map(([index]) => u32(index + 1))
      // Sync sample table
    ]);
  };
  var stsc = (track) => {
    return fullBox("stsc", 0, 0, [
      u32(track.compactlyCodedChunkTable.length),
      // Number of entries
      track.compactlyCodedChunkTable.map((x) => [
        // Sample-to-chunk table
        u32(x.firstChunk),
        // First chunk
        u32(x.samplesPerChunk),
        // Samples per chunk
        u32(1)
        // Sample description index
      ])
    ]);
  };
  var stsz = (track) => fullBox("stsz", 0, 0, [
    u32(0),
    // Sample size (0 means non-constant size)
    u32(track.samples.length),
    // Number of entries
    track.samples.map((x) => u32(x.size))
    // Sample size table
  ]);
  var stco = (track) => {
    if (track.finalizedChunks.length > 0 && last(track.finalizedChunks).offset >= 2 ** 32) {
      return fullBox("co64", 0, 0, [
        u32(track.finalizedChunks.length),
        // Number of entries
        track.finalizedChunks.map((x) => u64(x.offset))
        // Chunk offset table
      ]);
    }
    return fullBox("stco", 0, 0, [
      u32(track.finalizedChunks.length),
      // Number of entries
      track.finalizedChunks.map((x) => u32(x.offset))
      // Chunk offset table
    ]);
  };
  var ctts = (track) => {
    return fullBox("ctts", 0, 0, [
      u32(track.compositionTimeOffsetTable.length),
      // Number of entries
      track.compositionTimeOffsetTable.map((x) => [
        // Time-to-sample table
        u32(x.sampleCount),
        // Sample count
        u32(x.sampleCompositionTimeOffset)
        // Sample offset
      ])
    ]);
  };
  var mvex = (tracks) => {
    return box("mvex", null, tracks.map(trex));
  };
  var trex = (track) => {
    return fullBox("trex", 0, 0, [
      u32(track.id),
      // Track ID
      u32(1),
      // Default sample description index
      u32(0),
      // Default sample duration
      u32(0),
      // Default sample size
      u32(0)
      // Default sample flags
    ]);
  };
  var moof = (sequenceNumber, tracks) => {
    return box("moof", null, [
      mfhd(sequenceNumber),
      ...tracks.map(traf)
    ]);
  };
  var mfhd = (sequenceNumber) => {
    return fullBox("mfhd", 0, 0, [
      u32(sequenceNumber)
      // Sequence number
    ]);
  };
  var fragmentSampleFlags = (sample) => {
    let byte1 = 0;
    let byte2 = 0;
    let byte3 = 0;
    let byte4 = 0;
    let sampleIsDifferenceSample = sample.type === "delta";
    byte2 |= +sampleIsDifferenceSample;
    if (sampleIsDifferenceSample) {
      byte1 |= 1;
    } else {
      byte1 |= 2;
    }
    return byte1 << 24 | byte2 << 16 | byte3 << 8 | byte4;
  };
  var traf = (track) => {
    return box("traf", null, [
      tfhd(track),
      tfdt(track),
      trun(track)
    ]);
  };
  var tfhd = (track) => {
    let tfFlags = 0;
    tfFlags |= 8;
    tfFlags |= 16;
    tfFlags |= 32;
    tfFlags |= 131072;
    let referenceSample = track.currentChunk.samples[1] ?? track.currentChunk.samples[0];
    let referenceSampleInfo = {
      duration: referenceSample.timescaleUnitsToNextSample,
      size: referenceSample.size,
      flags: fragmentSampleFlags(referenceSample)
    };
    return fullBox("tfhd", 0, tfFlags, [
      u32(track.id),
      // Track ID
      u32(referenceSampleInfo.duration),
      // Default sample duration
      u32(referenceSampleInfo.size),
      // Default sample size
      u32(referenceSampleInfo.flags)
      // Default sample flags
    ]);
  };
  var tfdt = (track) => {
    return fullBox("tfdt", 1, 0, [
      u64(intoTimescale(track.currentChunk.startTimestamp, track.timescale))
      // Base Media Decode Time
    ]);
  };
  var trun = (track) => {
    let allSampleDurations = track.currentChunk.samples.map((x) => x.timescaleUnitsToNextSample);
    let allSampleSizes = track.currentChunk.samples.map((x) => x.size);
    let allSampleFlags = track.currentChunk.samples.map(fragmentSampleFlags);
    let allSampleCompositionTimeOffsets = track.currentChunk.samples.map((x) => intoTimescale(x.presentationTimestamp - x.decodeTimestamp, track.timescale));
    let uniqueSampleDurations = new Set(allSampleDurations);
    let uniqueSampleSizes = new Set(allSampleSizes);
    let uniqueSampleFlags = new Set(allSampleFlags);
    let uniqueSampleCompositionTimeOffsets = new Set(allSampleCompositionTimeOffsets);
    let firstSampleFlagsPresent = uniqueSampleFlags.size === 2 && allSampleFlags[0] !== allSampleFlags[1];
    let sampleDurationPresent = uniqueSampleDurations.size > 1;
    let sampleSizePresent = uniqueSampleSizes.size > 1;
    let sampleFlagsPresent = !firstSampleFlagsPresent && uniqueSampleFlags.size > 1;
    let sampleCompositionTimeOffsetsPresent = uniqueSampleCompositionTimeOffsets.size > 1 || [...uniqueSampleCompositionTimeOffsets].some((x) => x !== 0);
    let flags = 0;
    flags |= 1;
    flags |= 4 * +firstSampleFlagsPresent;
    flags |= 256 * +sampleDurationPresent;
    flags |= 512 * +sampleSizePresent;
    flags |= 1024 * +sampleFlagsPresent;
    flags |= 2048 * +sampleCompositionTimeOffsetsPresent;
    return fullBox("trun", 1, flags, [
      u32(track.currentChunk.samples.length),
      // Sample count
      u32(track.currentChunk.offset - track.currentChunk.moofOffset || 0),
      // Data offset
      firstSampleFlagsPresent ? u32(allSampleFlags[0]) : [],
      track.currentChunk.samples.map((_, i) => [
        sampleDurationPresent ? u32(allSampleDurations[i]) : [],
        // Sample duration
        sampleSizePresent ? u32(allSampleSizes[i]) : [],
        // Sample size
        sampleFlagsPresent ? u32(allSampleFlags[i]) : [],
        // Sample flags
        // Sample composition time offsets
        sampleCompositionTimeOffsetsPresent ? i32(allSampleCompositionTimeOffsets[i]) : []
      ])
    ]);
  };
  var mfra = (tracks) => {
    return box("mfra", null, [
      ...tracks.map(tfra),
      mfro()
    ]);
  };
  var tfra = (track, trackIndex) => {
    let version = 1;
    return fullBox("tfra", version, 0, [
      u32(track.id),
      // Track ID
      u32(63),
      // This specifies that traf number, trun number and sample number are 32-bit ints
      u32(track.finalizedChunks.length),
      // Number of entries
      track.finalizedChunks.map((chunk) => [
        u64(intoTimescale(chunk.startTimestamp, track.timescale)),
        // Time
        u64(chunk.moofOffset),
        // moof offset
        u32(trackIndex + 1),
        // traf number
        u32(1),
        // trun number
        u32(1)
        // Sample number
      ])
    ]);
  };
  var mfro = () => {
    return fullBox("mfro", 0, 0, [
      // This value needs to be overwritten manually from the outside, where the actual size of the enclosing mfra box
      // is known
      u32(0)
      // Size
    ]);
  };
  var VIDEO_CODEC_TO_BOX_NAME = {
    "avc": "avc1",
    "hevc": "hvc1",
    "vp9": "vp09",
    "av1": "av01"
  };
  var VIDEO_CODEC_TO_CONFIGURATION_BOX = {
    "avc": avcC,
    "hevc": hvcC,
    "vp9": vpcC,
    "av1": av1C
  };
  var AUDIO_CODEC_TO_BOX_NAME = {
    "aac": "mp4a",
    "opus": "Opus"
  };
  var AUDIO_CODEC_TO_CONFIGURATION_BOX = {
    "aac": esds,
    "opus": dOps
  };

  // src/target.ts
  var isTarget = Symbol("isTarget");
  var Target = class {
  };
  isTarget;
  var ArrayBufferTarget = class extends Target {
    constructor() {
      super(...arguments);
      this.buffer = null;
    }
  };
  var StreamTarget = class extends Target {
    constructor(options) {
      super();
      this.options = options;
      if (typeof options !== "object") {
        throw new TypeError("StreamTarget requires an options object to be passed to its constructor.");
      }
      if (options.onData) {
        if (typeof options.onData !== "function") {
          throw new TypeError("options.onData, when provided, must be a function.");
        }
        if (options.onData.length < 2) {
          throw new TypeError(
            "options.onData, when provided, must be a function that takes in at least two arguments (data and position). Ignoring the position argument, which specifies the byte offset at which the data is to be written, can lead to broken outputs."
          );
        }
      }
      if (options.chunked !== void 0 && typeof options.chunked !== "boolean") {
        throw new TypeError("options.chunked, when provided, must be a boolean.");
      }
      if (options.chunkSize !== void 0 && (!Number.isInteger(options.chunkSize) || options.chunkSize < 1024)) {
        throw new TypeError("options.chunkSize, when provided, must be an integer and not smaller than 1024.");
      }
    }
  };
  var FileSystemWritableFileStreamTarget = class extends Target {
    constructor(stream, options) {
      super();
      this.stream = stream;
      this.options = options;
      if (!(stream instanceof FileSystemWritableFileStream)) {
        throw new TypeError("FileSystemWritableFileStreamTarget requires a FileSystemWritableFileStream instance.");
      }
      if (options !== void 0 && typeof options !== "object") {
        throw new TypeError("FileSystemWritableFileStreamTarget's options, when provided, must be an object.");
      }
      if (options) {
        if (options.chunkSize !== void 0 && (!Number.isInteger(options.chunkSize) || options.chunkSize <= 0)) {
          throw new TypeError("options.chunkSize, when provided, must be a positive integer");
        }
      }
    }
  };

  // src/writer.ts
  var _helper, _helperView;
  var Writer = class {
    constructor() {
      this.pos = 0;
      __privateAdd(this, _helper, new Uint8Array(8));
      __privateAdd(this, _helperView, new DataView(__privateGet(this, _helper).buffer));
      /**
       * Stores the position from the start of the file to where boxes elements have been written. This is used to
       * rewrite/edit elements that were already added before, and to measure sizes of things.
       */
      this.offsets = /* @__PURE__ */ new WeakMap();
    }
    /** Sets the current position for future writes to a new one. */
    seek(newPos) {
      this.pos = newPos;
    }
    writeU32(value) {
      __privateGet(this, _helperView).setUint32(0, value, false);
      this.write(__privateGet(this, _helper).subarray(0, 4));
    }
    writeU64(value) {
      __privateGet(this, _helperView).setUint32(0, Math.floor(value / 2 ** 32), false);
      __privateGet(this, _helperView).setUint32(4, value, false);
      this.write(__privateGet(this, _helper).subarray(0, 8));
    }
    writeAscii(text) {
      for (let i = 0; i < text.length; i++) {
        __privateGet(this, _helperView).setUint8(i % 8, text.charCodeAt(i));
        if (i % 8 === 7)
          this.write(__privateGet(this, _helper));
      }
      if (text.length % 8 !== 0) {
        this.write(__privateGet(this, _helper).subarray(0, text.length % 8));
      }
    }
    writeBox(box2) {
      this.offsets.set(box2, this.pos);
      if (box2.contents && !box2.children) {
        this.writeBoxHeader(box2, box2.size ?? box2.contents.byteLength + 8);
        this.write(box2.contents);
      } else {
        let startPos = this.pos;
        this.writeBoxHeader(box2, 0);
        if (box2.contents)
          this.write(box2.contents);
        if (box2.children) {
          for (let child of box2.children)
            if (child)
              this.writeBox(child);
        }
        let endPos = this.pos;
        let size = box2.size ?? endPos - startPos;
        this.seek(startPos);
        this.writeBoxHeader(box2, size);
        this.seek(endPos);
      }
    }
    writeBoxHeader(box2, size) {
      this.writeU32(box2.largeSize ? 1 : size);
      this.writeAscii(box2.type);
      if (box2.largeSize)
        this.writeU64(size);
    }
    measureBoxHeader(box2) {
      return 8 + (box2.largeSize ? 8 : 0);
    }
    patchBox(box2) {
      let endPos = this.pos;
      this.seek(this.offsets.get(box2));
      this.writeBox(box2);
      this.seek(endPos);
    }
    measureBox(box2) {
      if (box2.contents && !box2.children) {
        let headerSize = this.measureBoxHeader(box2);
        return headerSize + box2.contents.byteLength;
      } else {
        let result = this.measureBoxHeader(box2);
        if (box2.contents)
          result += box2.contents.byteLength;
        if (box2.children) {
          for (let child of box2.children)
            if (child)
              result += this.measureBox(child);
        }
        return result;
      }
    }
  };
  _helper = new WeakMap();
  _helperView = new WeakMap();
  var _target, _buffer, _bytes, _maxPos, _ensureSize, ensureSize_fn;
  var ArrayBufferTargetWriter = class extends Writer {
    constructor(target) {
      super();
      __privateAdd(this, _ensureSize);
      __privateAdd(this, _target, void 0);
      __privateAdd(this, _buffer, new ArrayBuffer(2 ** 16));
      __privateAdd(this, _bytes, new Uint8Array(__privateGet(this, _buffer)));
      __privateAdd(this, _maxPos, 0);
      __privateSet(this, _target, target);
    }
    write(data) {
      __privateMethod(this, _ensureSize, ensureSize_fn).call(this, this.pos + data.byteLength);
      __privateGet(this, _bytes).set(data, this.pos);
      this.pos += data.byteLength;
      __privateSet(this, _maxPos, Math.max(__privateGet(this, _maxPos), this.pos));
    }
    finalize() {
      __privateMethod(this, _ensureSize, ensureSize_fn).call(this, this.pos);
      __privateGet(this, _target).buffer = __privateGet(this, _buffer).slice(0, Math.max(__privateGet(this, _maxPos), this.pos));
    }
  };
  _target = new WeakMap();
  _buffer = new WeakMap();
  _bytes = new WeakMap();
  _maxPos = new WeakMap();
  _ensureSize = new WeakSet();
  ensureSize_fn = function(size) {
    let newLength = __privateGet(this, _buffer).byteLength;
    while (newLength < size)
      newLength *= 2;
    if (newLength === __privateGet(this, _buffer).byteLength)
      return;
    let newBuffer = new ArrayBuffer(newLength);
    let newBytes = new Uint8Array(newBuffer);
    newBytes.set(__privateGet(this, _bytes), 0);
    __privateSet(this, _buffer, newBuffer);
    __privateSet(this, _bytes, newBytes);
  };
  var DEFAULT_CHUNK_SIZE = 2 ** 24;
  var MAX_CHUNKS_AT_ONCE = 2;
  var _target2, _sections, _chunked, _chunkSize, _chunks, _writeDataIntoChunks, writeDataIntoChunks_fn, _insertSectionIntoChunk, insertSectionIntoChunk_fn, _createChunk, createChunk_fn, _flushChunks, flushChunks_fn;
  var StreamTargetWriter = class extends Writer {
    constructor(target) {
      super();
      __privateAdd(this, _writeDataIntoChunks);
      __privateAdd(this, _insertSectionIntoChunk);
      __privateAdd(this, _createChunk);
      __privateAdd(this, _flushChunks);
      __privateAdd(this, _target2, void 0);
      __privateAdd(this, _sections, []);
      __privateAdd(this, _chunked, void 0);
      __privateAdd(this, _chunkSize, void 0);
      /**
       * The data is divided up into fixed-size chunks, whose contents are first filled in RAM and then flushed out.
       * A chunk is flushed if all of its contents have been written.
       */
      __privateAdd(this, _chunks, []);
      __privateSet(this, _target2, target);
      __privateSet(this, _chunked, target.options?.chunked ?? false);
      __privateSet(this, _chunkSize, target.options?.chunkSize ?? DEFAULT_CHUNK_SIZE);
    }
    write(data) {
      __privateGet(this, _sections).push({
        data: data.slice(),
        start: this.pos
      });
      this.pos += data.byteLength;
    }
    flush() {
      if (__privateGet(this, _sections).length === 0)
        return;
      let chunks = [];
      let sorted = [...__privateGet(this, _sections)].sort((a, b) => a.start - b.start);
      chunks.push({
        start: sorted[0].start,
        size: sorted[0].data.byteLength
      });
      for (let i = 1; i < sorted.length; i++) {
        let lastChunk = chunks[chunks.length - 1];
        let section = sorted[i];
        if (section.start <= lastChunk.start + lastChunk.size) {
          lastChunk.size = Math.max(lastChunk.size, section.start + section.data.byteLength - lastChunk.start);
        } else {
          chunks.push({
            start: section.start,
            size: section.data.byteLength
          });
        }
      }
      for (let chunk of chunks) {
        chunk.data = new Uint8Array(chunk.size);
        for (let section of __privateGet(this, _sections)) {
          if (chunk.start <= section.start && section.start < chunk.start + chunk.size) {
            chunk.data.set(section.data, section.start - chunk.start);
          }
        }
        if (__privateGet(this, _chunked)) {
          __privateMethod(this, _writeDataIntoChunks, writeDataIntoChunks_fn).call(this, chunk.data, chunk.start);
          __privateMethod(this, _flushChunks, flushChunks_fn).call(this);
        } else {
          __privateGet(this, _target2).options.onData?.(chunk.data, chunk.start);
        }
      }
      __privateGet(this, _sections).length = 0;
    }
    finalize() {
      if (__privateGet(this, _chunked)) {
        __privateMethod(this, _flushChunks, flushChunks_fn).call(this, true);
      }
    }
  };
  _target2 = new WeakMap();
  _sections = new WeakMap();
  _chunked = new WeakMap();
  _chunkSize = new WeakMap();
  _chunks = new WeakMap();
  _writeDataIntoChunks = new WeakSet();
  writeDataIntoChunks_fn = function(data, position) {
    let chunkIndex = __privateGet(this, _chunks).findIndex((x) => x.start <= position && position < x.start + __privateGet(this, _chunkSize));
    if (chunkIndex === -1)
      chunkIndex = __privateMethod(this, _createChunk, createChunk_fn).call(this, position);
    let chunk = __privateGet(this, _chunks)[chunkIndex];
    let relativePosition = position - chunk.start;
    let toWrite = data.subarray(0, Math.min(__privateGet(this, _chunkSize) - relativePosition, data.byteLength));
    chunk.data.set(toWrite, relativePosition);
    let section = {
      start: relativePosition,
      end: relativePosition + toWrite.byteLength
    };
    __privateMethod(this, _insertSectionIntoChunk, insertSectionIntoChunk_fn).call(this, chunk, section);
    if (chunk.written[0].start === 0 && chunk.written[0].end === __privateGet(this, _chunkSize)) {
      chunk.shouldFlush = true;
    }
    if (__privateGet(this, _chunks).length > MAX_CHUNKS_AT_ONCE) {
      for (let i = 0; i < __privateGet(this, _chunks).length - 1; i++) {
        __privateGet(this, _chunks)[i].shouldFlush = true;
      }
      __privateMethod(this, _flushChunks, flushChunks_fn).call(this);
    }
    if (toWrite.byteLength < data.byteLength) {
      __privateMethod(this, _writeDataIntoChunks, writeDataIntoChunks_fn).call(this, data.subarray(toWrite.byteLength), position + toWrite.byteLength);
    }
  };
  _insertSectionIntoChunk = new WeakSet();
  insertSectionIntoChunk_fn = function(chunk, section) {
    let low = 0;
    let high = chunk.written.length - 1;
    let index = -1;
    while (low <= high) {
      let mid = Math.floor(low + (high - low + 1) / 2);
      if (chunk.written[mid].start <= section.start) {
        low = mid + 1;
        index = mid;
      } else {
        high = mid - 1;
      }
    }
    chunk.written.splice(index + 1, 0, section);
    if (index === -1 || chunk.written[index].end < section.start)
      index++;
    while (index < chunk.written.length - 1 && chunk.written[index].end >= chunk.written[index + 1].start) {
      chunk.written[index].end = Math.max(chunk.written[index].end, chunk.written[index + 1].end);
      chunk.written.splice(index + 1, 1);
    }
  };
  _createChunk = new WeakSet();
  createChunk_fn = function(includesPosition) {
    let start = Math.floor(includesPosition / __privateGet(this, _chunkSize)) * __privateGet(this, _chunkSize);
    let chunk = {
      start,
      data: new Uint8Array(__privateGet(this, _chunkSize)),
      written: [],
      shouldFlush: false
    };
    __privateGet(this, _chunks).push(chunk);
    __privateGet(this, _chunks).sort((a, b) => a.start - b.start);
    return __privateGet(this, _chunks).indexOf(chunk);
  };
  _flushChunks = new WeakSet();
  flushChunks_fn = function(force = false) {
    for (let i = 0; i < __privateGet(this, _chunks).length; i++) {
      let chunk = __privateGet(this, _chunks)[i];
      if (!chunk.shouldFlush && !force)
        continue;
      for (let section of chunk.written) {
        __privateGet(this, _target2).options.onData?.(
          chunk.data.subarray(section.start, section.end),
          chunk.start + section.start
        );
      }
      __privateGet(this, _chunks).splice(i--, 1);
    }
  };
  var FileSystemWritableFileStreamTargetWriter = class extends StreamTargetWriter {
    constructor(target) {
      super(new StreamTarget({
        onData: (data, position) => target.stream.write({
          type: "write",
          data,
          position
        }),
        chunked: true,
        chunkSize: target.options?.chunkSize
      }));
    }
  };

  // src/muxer.ts
  var GLOBAL_TIMESCALE = 1e3;
  var SUPPORTED_VIDEO_CODECS = ["avc", "hevc", "vp9", "av1"];
  var SUPPORTED_AUDIO_CODECS = ["aac", "opus"];
  var TIMESTAMP_OFFSET = 2082844800;
  var FIRST_TIMESTAMP_BEHAVIORS = ["strict", "offset", "cross-track-offset"];
  var _options, _writer, _ftypSize, _mdat, _videoTrack, _audioTrack, _creationTime, _finalizedChunks, _nextFragmentNumber, _videoSampleQueue, _audioSampleQueue, _finalized, _validateOptions, validateOptions_fn, _writeHeader, writeHeader_fn, _computeMoovSizeUpperBound, computeMoovSizeUpperBound_fn, _prepareTracks, prepareTracks_fn, _generateMpeg4AudioSpecificConfig, generateMpeg4AudioSpecificConfig_fn, _createSampleForTrack, createSampleForTrack_fn, _addSampleToTrack, addSampleToTrack_fn, _validateTimestamp, validateTimestamp_fn, _finalizeCurrentChunk, finalizeCurrentChunk_fn, _finalizeFragment, finalizeFragment_fn, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn, _ensureNotFinalized, ensureNotFinalized_fn;
  var Muxer = class {
    constructor(options) {
      __privateAdd(this, _validateOptions);
      __privateAdd(this, _writeHeader);
      __privateAdd(this, _computeMoovSizeUpperBound);
      __privateAdd(this, _prepareTracks);
      // https://wiki.multimedia.cx/index.php/MPEG-4_Audio
      __privateAdd(this, _generateMpeg4AudioSpecificConfig);
      __privateAdd(this, _createSampleForTrack);
      __privateAdd(this, _addSampleToTrack);
      __privateAdd(this, _validateTimestamp);
      __privateAdd(this, _finalizeCurrentChunk);
      __privateAdd(this, _finalizeFragment);
      __privateAdd(this, _maybeFlushStreamingTargetWriter);
      __privateAdd(this, _ensureNotFinalized);
      __privateAdd(this, _options, void 0);
      __privateAdd(this, _writer, void 0);
      __privateAdd(this, _ftypSize, void 0);
      __privateAdd(this, _mdat, void 0);
      __privateAdd(this, _videoTrack, null);
      __privateAdd(this, _audioTrack, null);
      __privateAdd(this, _creationTime, Math.floor(Date.now() / 1e3) + TIMESTAMP_OFFSET);
      __privateAdd(this, _finalizedChunks, []);
      // Fields for fragmented MP4:
      __privateAdd(this, _nextFragmentNumber, 1);
      __privateAdd(this, _videoSampleQueue, []);
      __privateAdd(this, _audioSampleQueue, []);
      __privateAdd(this, _finalized, false);
      __privateMethod(this, _validateOptions, validateOptions_fn).call(this, options);
      options.video = deepClone(options.video);
      options.audio = deepClone(options.audio);
      options.fastStart = deepClone(options.fastStart);
      this.target = options.target;
      __privateSet(this, _options, {
        firstTimestampBehavior: "strict",
        ...options
      });
      if (options.target instanceof ArrayBufferTarget) {
        __privateSet(this, _writer, new ArrayBufferTargetWriter(options.target));
      } else if (options.target instanceof StreamTarget) {
        __privateSet(this, _writer, new StreamTargetWriter(options.target));
      } else if (options.target instanceof FileSystemWritableFileStreamTarget) {
        __privateSet(this, _writer, new FileSystemWritableFileStreamTargetWriter(options.target));
      } else {
        throw new Error(`Invalid target: ${options.target}`);
      }
      __privateMethod(this, _prepareTracks, prepareTracks_fn).call(this);
      __privateMethod(this, _writeHeader, writeHeader_fn).call(this);
    }
    addVideoChunk(sample, meta, timestamp, compositionTimeOffset) {
      if (!(sample instanceof EncodedVideoChunk)) {
        throw new TypeError("addVideoChunk's first argument (sample) must be of type EncodedVideoChunk.");
      }
      if (meta && typeof meta !== "object") {
        throw new TypeError("addVideoChunk's second argument (meta), when provided, must be an object.");
      }
      if (timestamp !== void 0 && (!Number.isFinite(timestamp) || timestamp < 0)) {
        throw new TypeError(
          "addVideoChunk's third argument (timestamp), when provided, must be a non-negative real number."
        );
      }
      if (compositionTimeOffset !== void 0 && !Number.isFinite(compositionTimeOffset)) {
        throw new TypeError(
          "addVideoChunk's fourth argument (compositionTimeOffset), when provided, must be a real number."
        );
      }
      let data = new Uint8Array(sample.byteLength);
      sample.copyTo(data);
      this.addVideoChunkRaw(
        data,
        sample.type,
        timestamp ?? sample.timestamp,
        sample.duration,
        meta,
        compositionTimeOffset
      );
    }
    addVideoChunkRaw(data, type, timestamp, duration, meta, compositionTimeOffset) {
      if (!(data instanceof Uint8Array)) {
        throw new TypeError("addVideoChunkRaw's first argument (data) must be an instance of Uint8Array.");
      }
      if (type !== "key" && type !== "delta") {
        throw new TypeError("addVideoChunkRaw's second argument (type) must be either 'key' or 'delta'.");
      }
      if (!Number.isFinite(timestamp) || timestamp < 0) {
        throw new TypeError("addVideoChunkRaw's third argument (timestamp) must be a non-negative real number.");
      }
      if (!Number.isFinite(duration) || duration < 0) {
        throw new TypeError("addVideoChunkRaw's fourth argument (duration) must be a non-negative real number.");
      }
      if (meta && typeof meta !== "object") {
        throw new TypeError("addVideoChunkRaw's fifth argument (meta), when provided, must be an object.");
      }
      if (compositionTimeOffset !== void 0 && !Number.isFinite(compositionTimeOffset)) {
        throw new TypeError(
          "addVideoChunkRaw's sixth argument (compositionTimeOffset), when provided, must be a real number."
        );
      }
      __privateMethod(this, _ensureNotFinalized, ensureNotFinalized_fn).call(this);
      if (!__privateGet(this, _options).video)
        throw new Error("No video track declared.");
      if (typeof __privateGet(this, _options).fastStart === "object" && __privateGet(this, _videoTrack).samples.length === __privateGet(this, _options).fastStart.expectedVideoChunks) {
        throw new Error(`Cannot add more video chunks than specified in 'fastStart' (${__privateGet(this, _options).fastStart.expectedVideoChunks}).`);
      }
      let videoSample = __privateMethod(this, _createSampleForTrack, createSampleForTrack_fn).call(this, __privateGet(this, _videoTrack), data, type, timestamp, duration, meta, compositionTimeOffset);
      if (__privateGet(this, _options).fastStart === "fragmented" && __privateGet(this, _audioTrack)) {
        while (__privateGet(this, _audioSampleQueue).length > 0 && __privateGet(this, _audioSampleQueue)[0].decodeTimestamp <= videoSample.decodeTimestamp) {
          let audioSample = __privateGet(this, _audioSampleQueue).shift();
          __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
        }
        if (videoSample.decodeTimestamp <= __privateGet(this, _audioTrack).lastDecodeTimestamp) {
          __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
        } else {
          __privateGet(this, _videoSampleQueue).push(videoSample);
        }
      } else {
        __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
      }
    }
    addAudioChunk(sample, meta, timestamp) {
      if (!(sample instanceof EncodedAudioChunk)) {
        throw new TypeError("addAudioChunk's first argument (sample) must be of type EncodedAudioChunk.");
      }
      if (meta && typeof meta !== "object") {
        throw new TypeError("addAudioChunk's second argument (meta), when provided, must be an object.");
      }
      if (timestamp !== void 0 && (!Number.isFinite(timestamp) || timestamp < 0)) {
        throw new TypeError(
          "addAudioChunk's third argument (timestamp), when provided, must be a non-negative real number."
        );
      }
      let data = new Uint8Array(sample.byteLength);
      sample.copyTo(data);
      this.addAudioChunkRaw(data, sample.type, timestamp ?? sample.timestamp, sample.duration, meta);
    }
    addAudioChunkRaw(data, type, timestamp, duration, meta) {
      if (!(data instanceof Uint8Array)) {
        throw new TypeError("addAudioChunkRaw's first argument (data) must be an instance of Uint8Array.");
      }
      if (type !== "key" && type !== "delta") {
        throw new TypeError("addAudioChunkRaw's second argument (type) must be either 'key' or 'delta'.");
      }
      if (!Number.isFinite(timestamp) || timestamp < 0) {
        throw new TypeError("addAudioChunkRaw's third argument (timestamp) must be a non-negative real number.");
      }
      if (!Number.isFinite(duration) || duration < 0) {
        throw new TypeError("addAudioChunkRaw's fourth argument (duration) must be a non-negative real number.");
      }
      if (meta && typeof meta !== "object") {
        throw new TypeError("addAudioChunkRaw's fifth argument (meta), when provided, must be an object.");
      }
      __privateMethod(this, _ensureNotFinalized, ensureNotFinalized_fn).call(this);
      if (!__privateGet(this, _options).audio)
        throw new Error("No audio track declared.");
      if (typeof __privateGet(this, _options).fastStart === "object" && __privateGet(this, _audioTrack).samples.length === __privateGet(this, _options).fastStart.expectedAudioChunks) {
        throw new Error(`Cannot add more audio chunks than specified in 'fastStart' (${__privateGet(this, _options).fastStart.expectedAudioChunks}).`);
      }
      let audioSample = __privateMethod(this, _createSampleForTrack, createSampleForTrack_fn).call(this, __privateGet(this, _audioTrack), data, type, timestamp, duration, meta);
      if (__privateGet(this, _options).fastStart === "fragmented" && __privateGet(this, _videoTrack)) {
        while (__privateGet(this, _videoSampleQueue).length > 0 && __privateGet(this, _videoSampleQueue)[0].decodeTimestamp <= audioSample.decodeTimestamp) {
          let videoSample = __privateGet(this, _videoSampleQueue).shift();
          __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
        }
        if (audioSample.decodeTimestamp <= __privateGet(this, _videoTrack).lastDecodeTimestamp) {
          __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
        } else {
          __privateGet(this, _audioSampleQueue).push(audioSample);
        }
      } else {
        __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
      }
    }
    /** Finalizes the file, making it ready for use. Must be called after all video and audio chunks have been added. */
    finalize() {
      if (__privateGet(this, _finalized)) {
        throw new Error("Cannot finalize a muxer more than once.");
      }
      if (__privateGet(this, _options).fastStart === "fragmented") {
        for (let videoSample of __privateGet(this, _videoSampleQueue))
          __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);
        for (let audioSample of __privateGet(this, _audioSampleQueue))
          __privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _audioTrack), audioSample);
        __privateMethod(this, _finalizeFragment, finalizeFragment_fn).call(this, false);
      } else {
        if (__privateGet(this, _videoTrack))
          __privateMethod(this, _finalizeCurrentChunk, finalizeCurrentChunk_fn).call(this, __privateGet(this, _videoTrack));
        if (__privateGet(this, _audioTrack))
          __privateMethod(this, _finalizeCurrentChunk, finalizeCurrentChunk_fn).call(this, __privateGet(this, _audioTrack));
      }
      let tracks = [__privateGet(this, _videoTrack), __privateGet(this, _audioTrack)].filter(Boolean);
      if (__privateGet(this, _options).fastStart === "in-memory") {
        let mdatSize;
        for (let i = 0; i < 2; i++) {
          let movieBox2 = moov(tracks, __privateGet(this, _creationTime));
          let movieBoxSize = __privateGet(this, _writer).measureBox(movieBox2);
          mdatSize = __privateGet(this, _writer).measureBox(__privateGet(this, _mdat));
          let currentChunkPos = __privateGet(this, _writer).pos + movieBoxSize + mdatSize;
          for (let chunk of __privateGet(this, _finalizedChunks)) {
            chunk.offset = currentChunkPos;
            for (let { data } of chunk.samples) {
              currentChunkPos += data.byteLength;
              mdatSize += data.byteLength;
            }
          }
          if (currentChunkPos < 2 ** 32)
            break;
          if (mdatSize >= 2 ** 32)
            __privateGet(this, _mdat).largeSize = true;
        }
        let movieBox = moov(tracks, __privateGet(this, _creationTime));
        __privateGet(this, _writer).writeBox(movieBox);
        __privateGet(this, _mdat).size = mdatSize;
        __privateGet(this, _writer).writeBox(__privateGet(this, _mdat));
        for (let chunk of __privateGet(this, _finalizedChunks)) {
          for (let sample of chunk.samples) {
            __privateGet(this, _writer).write(sample.data);
            sample.data = null;
          }
        }
      } else if (__privateGet(this, _options).fastStart === "fragmented") {
        let startPos = __privateGet(this, _writer).pos;
        let mfraBox = mfra(tracks);
        __privateGet(this, _writer).writeBox(mfraBox);
        let mfraBoxSize = __privateGet(this, _writer).pos - startPos;
        __privateGet(this, _writer).seek(__privateGet(this, _writer).pos - 4);
        __privateGet(this, _writer).writeU32(mfraBoxSize);
      } else {
        let mdatPos = __privateGet(this, _writer).offsets.get(__privateGet(this, _mdat));
        let mdatSize = __privateGet(this, _writer).pos - mdatPos;
        __privateGet(this, _mdat).size = mdatSize;
        __privateGet(this, _mdat).largeSize = mdatSize >= 2 ** 32;
        __privateGet(this, _writer).patchBox(__privateGet(this, _mdat));
        let movieBox = moov(tracks, __privateGet(this, _creationTime));
        if (typeof __privateGet(this, _options).fastStart === "object") {
          __privateGet(this, _writer).seek(__privateGet(this, _ftypSize));
          __privateGet(this, _writer).writeBox(movieBox);
          let remainingBytes = mdatPos - __privateGet(this, _writer).pos;
          __privateGet(this, _writer).writeBox(free(remainingBytes));
        } else {
          __privateGet(this, _writer).writeBox(movieBox);
        }
      }
      __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
      __privateGet(this, _writer).finalize();
      __privateSet(this, _finalized, true);
    }
  };
  _options = new WeakMap();
  _writer = new WeakMap();
  _ftypSize = new WeakMap();
  _mdat = new WeakMap();
  _videoTrack = new WeakMap();
  _audioTrack = new WeakMap();
  _creationTime = new WeakMap();
  _finalizedChunks = new WeakMap();
  _nextFragmentNumber = new WeakMap();
  _videoSampleQueue = new WeakMap();
  _audioSampleQueue = new WeakMap();
  _finalized = new WeakMap();
  _validateOptions = new WeakSet();
  validateOptions_fn = function(options) {
    if (typeof options !== "object") {
      throw new TypeError("The muxer requires an options object to be passed to its constructor.");
    }
    if (!(options.target instanceof Target)) {
      throw new TypeError("The target must be provided and an instance of Target.");
    }
    if (options.video) {
      if (!SUPPORTED_VIDEO_CODECS.includes(options.video.codec)) {
        throw new TypeError(`Unsupported video codec: ${options.video.codec}`);
      }
      if (!Number.isInteger(options.video.width) || options.video.width <= 0) {
        throw new TypeError(`Invalid video width: ${options.video.width}. Must be a positive integer.`);
      }
      if (!Number.isInteger(options.video.height) || options.video.height <= 0) {
        throw new TypeError(`Invalid video height: ${options.video.height}. Must be a positive integer.`);
      }
      const videoRotation = options.video.rotation;
      if (typeof videoRotation === "number" && ![0, 90, 180, 270].includes(videoRotation)) {
        throw new TypeError(`Invalid video rotation: ${videoRotation}. Has to be 0, 90, 180 or 270.`);
      } else if (Array.isArray(videoRotation) && (videoRotation.length !== 9 || videoRotation.some((value) => typeof value !== "number"))) {
        throw new TypeError(`Invalid video transformation matrix: ${videoRotation.join()}`);
      }
      if (options.video.frameRate !== void 0 && (!Number.isInteger(options.video.frameRate) || options.video.frameRate <= 0)) {
        throw new TypeError(
          `Invalid video frame rate: ${options.video.frameRate}. Must be a positive integer.`
        );
      }
    }
    if (options.audio) {
      if (!SUPPORTED_AUDIO_CODECS.includes(options.audio.codec)) {
        throw new TypeError(`Unsupported audio codec: ${options.audio.codec}`);
      }
      if (!Number.isInteger(options.audio.numberOfChannels) || options.audio.numberOfChannels <= 0) {
        throw new TypeError(
          `Invalid number of audio channels: ${options.audio.numberOfChannels}. Must be a positive integer.`
        );
      }
      if (!Number.isInteger(options.audio.sampleRate) || options.audio.sampleRate <= 0) {
        throw new TypeError(
          `Invalid audio sample rate: ${options.audio.sampleRate}. Must be a positive integer.`
        );
      }
    }
    if (options.firstTimestampBehavior && !FIRST_TIMESTAMP_BEHAVIORS.includes(options.firstTimestampBehavior)) {
      throw new TypeError(`Invalid first timestamp behavior: ${options.firstTimestampBehavior}`);
    }
    if (typeof options.fastStart === "object") {
      if (options.video) {
        if (options.fastStart.expectedVideoChunks === void 0) {
          throw new TypeError(`'fastStart' is an object but is missing property 'expectedVideoChunks'.`);
        } else if (!Number.isInteger(options.fastStart.expectedVideoChunks) || options.fastStart.expectedVideoChunks < 0) {
          throw new TypeError(`'expectedVideoChunks' must be a non-negative integer.`);
        }
      }
      if (options.audio) {
        if (options.fastStart.expectedAudioChunks === void 0) {
          throw new TypeError(`'fastStart' is an object but is missing property 'expectedAudioChunks'.`);
        } else if (!Number.isInteger(options.fastStart.expectedAudioChunks) || options.fastStart.expectedAudioChunks < 0) {
          throw new TypeError(`'expectedAudioChunks' must be a non-negative integer.`);
        }
      }
    } else if (![false, "in-memory", "fragmented"].includes(options.fastStart)) {
      throw new TypeError(`'fastStart' option must be false, 'in-memory', 'fragmented' or an object.`);
    }
    if (options.minFragmentDuration !== void 0 && (!Number.isFinite(options.minFragmentDuration) || options.minFragmentDuration < 0)) {
      throw new TypeError(`'minFragmentDuration' must be a non-negative number.`);
    }
  };
  _writeHeader = new WeakSet();
  writeHeader_fn = function() {
    __privateGet(this, _writer).writeBox(ftyp({
      holdsAvc: __privateGet(this, _options).video?.codec === "avc",
      fragmented: __privateGet(this, _options).fastStart === "fragmented"
    }));
    __privateSet(this, _ftypSize, __privateGet(this, _writer).pos);
    if (__privateGet(this, _options).fastStart === "in-memory") {
      __privateSet(this, _mdat, mdat(false));
    } else if (__privateGet(this, _options).fastStart === "fragmented") {
    } else {
      if (typeof __privateGet(this, _options).fastStart === "object") {
        let moovSizeUpperBound = __privateMethod(this, _computeMoovSizeUpperBound, computeMoovSizeUpperBound_fn).call(this);
        __privateGet(this, _writer).seek(__privateGet(this, _writer).pos + moovSizeUpperBound);
      }
      __privateSet(this, _mdat, mdat(true));
      __privateGet(this, _writer).writeBox(__privateGet(this, _mdat));
    }
    __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
  };
  _computeMoovSizeUpperBound = new WeakSet();
  computeMoovSizeUpperBound_fn = function() {
    if (typeof __privateGet(this, _options).fastStart !== "object")
      return;
    let upperBound = 0;
    let sampleCounts = [
      __privateGet(this, _options).fastStart.expectedVideoChunks,
      __privateGet(this, _options).fastStart.expectedAudioChunks
    ];
    for (let n of sampleCounts) {
      if (!n)
        continue;
      upperBound += (4 + 4) * Math.ceil(2 / 3 * n);
      upperBound += 4 * n;
      upperBound += (4 + 4 + 4) * Math.ceil(2 / 3 * n);
      upperBound += 4 * n;
      upperBound += 8 * n;
    }
    upperBound += 4096;
    return upperBound;
  };
  _prepareTracks = new WeakSet();
  prepareTracks_fn = function() {
    if (__privateGet(this, _options).video) {
      __privateSet(this, _videoTrack, {
        id: 1,
        info: {
          type: "video",
          codec: __privateGet(this, _options).video.codec,
          width: __privateGet(this, _options).video.width,
          height: __privateGet(this, _options).video.height,
          rotation: __privateGet(this, _options).video.rotation ?? 0,
          decoderConfig: null
        },
        // The fallback contains many common frame rates as factors
        timescale: __privateGet(this, _options).video.frameRate ?? 57600,
        samples: [],
        finalizedChunks: [],
        currentChunk: null,
        firstDecodeTimestamp: void 0,
        lastDecodeTimestamp: -1,
        timeToSampleTable: [],
        compositionTimeOffsetTable: [],
        lastTimescaleUnits: null,
        lastSample: null,
        compactlyCodedChunkTable: []
      });
    }
    if (__privateGet(this, _options).audio) {
      __privateSet(this, _audioTrack, {
        id: __privateGet(this, _options).video ? 2 : 1,
        info: {
          type: "audio",
          codec: __privateGet(this, _options).audio.codec,
          numberOfChannels: __privateGet(this, _options).audio.numberOfChannels,
          sampleRate: __privateGet(this, _options).audio.sampleRate,
          decoderConfig: null
        },
        timescale: __privateGet(this, _options).audio.sampleRate,
        samples: [],
        finalizedChunks: [],
        currentChunk: null,
        firstDecodeTimestamp: void 0,
        lastDecodeTimestamp: -1,
        timeToSampleTable: [],
        compositionTimeOffsetTable: [],
        lastTimescaleUnits: null,
        lastSample: null,
        compactlyCodedChunkTable: []
      });
      if (__privateGet(this, _options).audio.codec === "aac") {
        let guessedCodecPrivate = __privateMethod(this, _generateMpeg4AudioSpecificConfig, generateMpeg4AudioSpecificConfig_fn).call(
          this,
          2,
          // Object type for AAC-LC, since it's the most common
          __privateGet(this, _options).audio.sampleRate,
          __privateGet(this, _options).audio.numberOfChannels
        );
        __privateGet(this, _audioTrack).info.decoderConfig = {
          codec: __privateGet(this, _options).audio.codec,
          description: guessedCodecPrivate,
          numberOfChannels: __privateGet(this, _options).audio.numberOfChannels,
          sampleRate: __privateGet(this, _options).audio.sampleRate
        };
      }
    }
  };
  _generateMpeg4AudioSpecificConfig = new WeakSet();
  generateMpeg4AudioSpecificConfig_fn = function(objectType, sampleRate, numberOfChannels) {
    let frequencyIndices = [96e3, 88200, 64e3, 48e3, 44100, 32e3, 24e3, 22050, 16e3, 12e3, 11025, 8e3, 7350];
    let frequencyIndex = frequencyIndices.indexOf(sampleRate);
    let channelConfig = numberOfChannels;
    let configBits = "";
    configBits += objectType.toString(2).padStart(5, "0");
    configBits += frequencyIndex.toString(2).padStart(4, "0");
    if (frequencyIndex === 15)
      configBits += sampleRate.toString(2).padStart(24, "0");
    configBits += channelConfig.toString(2).padStart(4, "0");
    let paddingLength = Math.ceil(configBits.length / 8) * 8;
    configBits = configBits.padEnd(paddingLength, "0");
    let configBytes = new Uint8Array(configBits.length / 8);
    for (let i = 0; i < configBits.length; i += 8) {
      configBytes[i / 8] = parseInt(configBits.slice(i, i + 8), 2);
    }
    return configBytes;
  };
  _createSampleForTrack = new WeakSet();
  createSampleForTrack_fn = function(track, data, type, timestamp, duration, meta, compositionTimeOffset) {
    let presentationTimestampInSeconds = timestamp / 1e6;
    let decodeTimestampInSeconds = (timestamp - (compositionTimeOffset ?? 0)) / 1e6;
    let durationInSeconds = duration / 1e6;
    let adjusted = __privateMethod(this, _validateTimestamp, validateTimestamp_fn).call(this, presentationTimestampInSeconds, decodeTimestampInSeconds, track);
    presentationTimestampInSeconds = adjusted.presentationTimestamp;
    decodeTimestampInSeconds = adjusted.decodeTimestamp;
    if (meta?.decoderConfig) {
      if (track.info.decoderConfig === null) {
        track.info.decoderConfig = meta.decoderConfig;
      } else {
        Object.assign(track.info.decoderConfig, meta.decoderConfig);
      }
    }
    let sample = {
      presentationTimestamp: presentationTimestampInSeconds,
      decodeTimestamp: decodeTimestampInSeconds,
      duration: durationInSeconds,
      data,
      size: data.byteLength,
      type,
      // Will be refined once the next sample comes in
      timescaleUnitsToNextSample: intoTimescale(durationInSeconds, track.timescale)
    };
    return sample;
  };
  _addSampleToTrack = new WeakSet();
  addSampleToTrack_fn = function(track, sample) {
    if (__privateGet(this, _options).fastStart !== "fragmented") {
      track.samples.push(sample);
    }
    const sampleCompositionTimeOffset = intoTimescale(sample.presentationTimestamp - sample.decodeTimestamp, track.timescale);
    if (track.lastTimescaleUnits !== null) {
      let timescaleUnits = intoTimescale(sample.decodeTimestamp, track.timescale, false);
      let delta = Math.round(timescaleUnits - track.lastTimescaleUnits);
      track.lastTimescaleUnits += delta;
      track.lastSample.timescaleUnitsToNextSample = delta;
      if (__privateGet(this, _options).fastStart !== "fragmented") {
        let lastTableEntry = last(track.timeToSampleTable);
        if (lastTableEntry.sampleCount === 1) {
          lastTableEntry.sampleDelta = delta;
          lastTableEntry.sampleCount++;
        } else if (lastTableEntry.sampleDelta === delta) {
          lastTableEntry.sampleCount++;
        } else {
          lastTableEntry.sampleCount--;
          track.timeToSampleTable.push({
            sampleCount: 2,
            sampleDelta: delta
          });
        }
        const lastCompositionTimeOffsetTableEntry = last(track.compositionTimeOffsetTable);
        if (lastCompositionTimeOffsetTableEntry.sampleCompositionTimeOffset === sampleCompositionTimeOffset) {
          lastCompositionTimeOffsetTableEntry.sampleCount++;
        } else {
          track.compositionTimeOffsetTable.push({
            sampleCount: 1,
            sampleCompositionTimeOffset
          });
        }
      }
    } else {
      track.lastTimescaleUnits = 0;
      if (__privateGet(this, _options).fastStart !== "fragmented") {
        track.timeToSampleTable.push({
          sampleCount: 1,
          sampleDelta: intoTimescale(sample.duration, track.timescale)
        });
        track.compositionTimeOffsetTable.push({
          sampleCount: 1,
          sampleCompositionTimeOffset
        });
      }
    }
    track.lastSample = sample;
    let beginNewChunk = false;
    if (!track.currentChunk) {
      beginNewChunk = true;
    } else {
      let currentChunkDuration = sample.presentationTimestamp - track.currentChunk.startTimestamp;
      if (__privateGet(this, _options).fastStart === "fragmented") {
        let mostImportantTrack = __privateGet(this, _videoTrack) ?? __privateGet(this, _audioTrack);
        const chunkDuration = __privateGet(this, _options).minFragmentDuration ?? 1;
        if (track === mostImportantTrack && sample.type === "key" && currentChunkDuration >= chunkDuration) {
          beginNewChunk = true;
          __privateMethod(this, _finalizeFragment, finalizeFragment_fn).call(this);
        }
      } else {
        beginNewChunk = currentChunkDuration >= 0.5;
      }
    }
    if (beginNewChunk) {
      if (track.currentChunk) {
        __privateMethod(this, _finalizeCurrentChunk, finalizeCurrentChunk_fn).call(this, track);
      }
      track.currentChunk = {
        startTimestamp: sample.presentationTimestamp,
        samples: []
      };
    }
    track.currentChunk.samples.push(sample);
  };
  _validateTimestamp = new WeakSet();
  validateTimestamp_fn = function(presentationTimestamp, decodeTimestamp, track) {
    const strictTimestampBehavior = __privateGet(this, _options).firstTimestampBehavior === "strict";
    const noLastDecodeTimestamp = track.lastDecodeTimestamp === -1;
    const timestampNonZero = decodeTimestamp !== 0;
    if (strictTimestampBehavior && noLastDecodeTimestamp && timestampNonZero) {
      throw new Error(
        `The first chunk for your media track must have a timestamp of 0 (received DTS=${decodeTimestamp}).Non-zero first timestamps are often caused by directly piping frames or audio data from a MediaStreamTrack into the encoder. Their timestamps are typically relative to the age of thedocument, which is probably what you want.

If you want to offset all timestamps of a track such that the first one is zero, set firstTimestampBehavior: 'offset' in the options.
`
      );
    } else if (__privateGet(this, _options).firstTimestampBehavior === "offset" || __privateGet(this, _options).firstTimestampBehavior === "cross-track-offset") {
      if (track.firstDecodeTimestamp === void 0) {
        track.firstDecodeTimestamp = decodeTimestamp;
      }
      let baseDecodeTimestamp;
      if (__privateGet(this, _options).firstTimestampBehavior === "offset") {
        baseDecodeTimestamp = track.firstDecodeTimestamp;
      } else {
        baseDecodeTimestamp = Math.min(
          __privateGet(this, _videoTrack)?.firstDecodeTimestamp ?? Infinity,
          __privateGet(this, _audioTrack)?.firstDecodeTimestamp ?? Infinity
        );
      }
      decodeTimestamp -= baseDecodeTimestamp;
      presentationTimestamp -= baseDecodeTimestamp;
    }
    if (decodeTimestamp < track.lastDecodeTimestamp) {
      throw new Error(
        `Timestamps must be monotonically increasing (DTS went from ${track.lastDecodeTimestamp * 1e6} to ${decodeTimestamp * 1e6}).`
      );
    }
    track.lastDecodeTimestamp = decodeTimestamp;
    return { presentationTimestamp, decodeTimestamp };
  };
  _finalizeCurrentChunk = new WeakSet();
  finalizeCurrentChunk_fn = function(track) {
    if (__privateGet(this, _options).fastStart === "fragmented") {
      throw new Error("Can't finalize individual chunks if 'fastStart' is set to 'fragmented'.");
    }
    if (!track.currentChunk)
      return;
    track.finalizedChunks.push(track.currentChunk);
    __privateGet(this, _finalizedChunks).push(track.currentChunk);
    if (track.compactlyCodedChunkTable.length === 0 || last(track.compactlyCodedChunkTable).samplesPerChunk !== track.currentChunk.samples.length) {
      track.compactlyCodedChunkTable.push({
        firstChunk: track.finalizedChunks.length,
        // 1-indexed
        samplesPerChunk: track.currentChunk.samples.length
      });
    }
    if (__privateGet(this, _options).fastStart === "in-memory") {
      track.currentChunk.offset = 0;
      return;
    }
    track.currentChunk.offset = __privateGet(this, _writer).pos;
    for (let sample of track.currentChunk.samples) {
      __privateGet(this, _writer).write(sample.data);
      sample.data = null;
    }
    __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
  };
  _finalizeFragment = new WeakSet();
  finalizeFragment_fn = function(flushStreamingWriter = true) {
    if (__privateGet(this, _options).fastStart !== "fragmented") {
      throw new Error("Can't finalize a fragment unless 'fastStart' is set to 'fragmented'.");
    }
    let tracks = [__privateGet(this, _videoTrack), __privateGet(this, _audioTrack)].filter((track) => track && track.currentChunk);
    if (tracks.length === 0)
      return;
    let fragmentNumber = __privateWrapper(this, _nextFragmentNumber)._++;
    if (fragmentNumber === 1) {
      let movieBox = moov(tracks, __privateGet(this, _creationTime), true);
      __privateGet(this, _writer).writeBox(movieBox);
    }
    let moofOffset = __privateGet(this, _writer).pos;
    let moofBox = moof(fragmentNumber, tracks);
    __privateGet(this, _writer).writeBox(moofBox);
    {
      let mdatBox = mdat(false);
      let totalTrackSampleSize = 0;
      for (let track of tracks) {
        for (let sample of track.currentChunk.samples) {
          totalTrackSampleSize += sample.size;
        }
      }
      let mdatSize = __privateGet(this, _writer).measureBox(mdatBox) + totalTrackSampleSize;
      if (mdatSize >= 2 ** 32) {
        mdatBox.largeSize = true;
        mdatSize = __privateGet(this, _writer).measureBox(mdatBox) + totalTrackSampleSize;
      }
      mdatBox.size = mdatSize;
      __privateGet(this, _writer).writeBox(mdatBox);
    }
    for (let track of tracks) {
      track.currentChunk.offset = __privateGet(this, _writer).pos;
      track.currentChunk.moofOffset = moofOffset;
      for (let sample of track.currentChunk.samples) {
        __privateGet(this, _writer).write(sample.data);
        sample.data = null;
      }
    }
    let endPos = __privateGet(this, _writer).pos;
    __privateGet(this, _writer).seek(__privateGet(this, _writer).offsets.get(moofBox));
    let newMoofBox = moof(fragmentNumber, tracks);
    __privateGet(this, _writer).writeBox(newMoofBox);
    __privateGet(this, _writer).seek(endPos);
    for (let track of tracks) {
      track.finalizedChunks.push(track.currentChunk);
      __privateGet(this, _finalizedChunks).push(track.currentChunk);
      track.currentChunk = null;
    }
    if (flushStreamingWriter) {
      __privateMethod(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn).call(this);
    }
  };
  _maybeFlushStreamingTargetWriter = new WeakSet();
  maybeFlushStreamingTargetWriter_fn = function() {
    if (__privateGet(this, _writer) instanceof StreamTargetWriter) {
      __privateGet(this, _writer).flush();
    }
  };
  _ensureNotFinalized = new WeakSet();
  ensureNotFinalized_fn = function() {
    if (__privateGet(this, _finalized)) {
      throw new Error("Cannot add new video or audio chunks after the file has been finalized.");
    }
  };
  return __toCommonJS(src_exports);
})();
if (typeof module === "object" && typeof module.exports === "object") Object.assign(module.exports, Mp4Muxer)

  const SCRIPT_ID = 'tripo-rotation-assistant';
  const SCRIPT_VERSION = '3.9.2';
  const STORAGE_KEY = `${SCRIPT_ID}:settings:v1`;
  const PROJECT_NAMES_KEY = `${SCRIPT_ID}:project-names:v1`;
  const PROJECT_LIBRARY_KEY = `${SCRIPT_ID}:project-library:v1`;
  const POINTER_ID = 731945;
  const MATERIALS = Object.freeze([
    { id: 'solid', label: '白膜', icon: 'solid.png' },
    { id: 'pbr', label: '贴图', icon: 'pbr.png' },
    { id: 'normal', label: '法线', icon: 'normal.png' },
  ]);
  const EXPORT_KINDS = Object.freeze([
    { id: 'screenshot', label: '单帧截图' },
    { id: 'uniform', label: '匀速圈' },
    { id: 'transition', label: '加速转场' },
  ]);
  const EXPORT_ITEMS = Object.freeze(EXPORT_KINDS.flatMap(kind => MATERIALS.map(material =>
    Object.freeze({ key: `${kind.id}:${material.id}`, kind: kind.id, material }))));

  const DEFAULTS = Object.freeze({
    configVersion: 7,
    direction: -1,
    pixelsPerTurnRatio: 1,
    uniformTurns: 1,
    uniformDuration: 3,
    transitionTurns: 4,
    accelerationDuration: 0.65,
    cruiseDuration: 0.7,
    decelerationDuration: 0.3,
    countdown: 2,
    settleDuration: 0.25,
    autoHide: true,
    recordEnabled: true,
    recordingScope: 'canvas',
    recordingFps: 60,
    videoBitrateMbps: 0,
    showAxisInOutput: false,
    transparentOutput: false,
    batchItems: Object.freeze(EXPORT_ITEMS.map(item => item.key)),
    batchWireframeVariants: false,
    studioLighting: false,
    lightingEnvironment: 1.4,
    lightingDirect: 1.2,
    lightingExposure: 1.15,
    brightSolid: false,
    solidLift: 0.5,
  });

  let settings = loadSettings();
  let panelVisible = true;
  let visibilityRevision = 0;
  let activeRun = null;
  let canvasStatusTimer = 0;
  let pendingProjectName = null;
  let pendingBatchStart = null;
  let batchRunning = false;
  let exportBusy = false;
  let pendingSave = null;
  let statusIsSticky = false;
  let lightingSnapshot = null;
  let solidLookSnapshot = null;
  let ui = null;

  // 录制只接受真实 Tres 上下文。没有入口时禁止回退到模拟鼠标。
  function unref(value) {
    return value?.__v_isRef ? value.value : value;
  }

  function findRenderContext(canvas) {
    const queue = [];
    for (let element = canvas; element; element = element.parentElement) {
      queue.push(element.__vueParentComponent, element._vnode, element.__vue_app__?._instance);
    }
    const seen = new Set();
    for (let index = 0; index < queue.length && index < 30000; index += 1) {
      let value;
      try { value = unref(queue[index]); } catch { continue; }
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      try {
        const manager = unref(value.renderer);
        if (unref(manager?.instance)?.domElement === canvas &&
            unref(value.scene)?.isScene && unref(value.camera?.activeCamera)?.isCamera) {
          const controls = unref(value.controls);
          const camera = unref(value.camera.activeCamera);
          if (controls?.camera !== camera || typeof controls.rotateTo !== 'function' ||
              typeof controls.getSpherical !== 'function' || typeof manager.onRender !== 'function' ||
              typeof manager.loop?.onBeforeLoop !== 'function') continue;
          return { context: value, manager, renderer: unref(manager.instance),
            scene: unref(value.scene), camera, controls, canvas };
        }
        // Only Vue component/vnode edges and exposed context; never walk assets,
        // WebGL internals, user data, or the entire window object.
        for (const key of ['component', 'subTree', 'parent', 'exposed', 'context', 'ctx', 'setupState', 'refs']) {
          if (value[key]) queue.push(value[key]);
        }
        if (Array.isArray(value.children)) queue.push(...value.children);
        if (value.suspense?.activeBranch) queue.push(value.suspense.activeBranch);
        for (const bag of [value.exposed, value.setupState, value.refs, value.provides]) {
          if (bag && typeof bag === 'object') {
            for (const key of Reflect.ownKeys(bag)) {
              try { queue.push(bag[key]); } catch { /* optional Vue getter */ }
            }
          }
        }
      } catch { /* unmounted Vue node: continue to other candidates */ }
    }
    throw new Error('未找到可靠的相机/渲染入口。已阻止旧式拖动录制；请点击“检查逐帧入口”查看诊断');
  }

  function restoreOriginalLighting() {
    const original = lightingSnapshot;
    if (!original) return;
    lightingSnapshot = null;
    original.scene.environmentIntensity = original.environmentIntensity;
    original.renderer.toneMappingExposure = original.toneMappingExposure;
    for (const [light, intensity] of original.lights) light.intensity = intensity;
    original.manager.invalidate();
  }

  function applyLightingPreset(strict = false) {
    if (!settings.studioLighting) {
      restoreOriginalLighting();
      return false;
    }
    const canvas = findViewerCanvas();
    if (!canvas) {
      if (strict) throw new Error('模型尚未加载，无法应用棚拍光照');
      return false;
    }
    let binding;
    try { binding = findRenderContext(canvas); }
    catch (error) { if (strict) throw error; return false; }
    const { scene, renderer, manager } = binding;
    if (lightingSnapshot && (lightingSnapshot.scene !== scene || lightingSnapshot.renderer !== renderer)) {
      restoreOriginalLighting();
    }
    if (!lightingSnapshot) {
      const lights = [];
      scene.traverse(object => {
        if (object.isLight && Number.isFinite(object.intensity)) lights.push([object, object.intensity]);
      });
      lightingSnapshot = { scene, renderer, manager, lights,
        environmentIntensity: scene.environmentIntensity,
        toneMappingExposure: renderer.toneMappingExposure };
    }
    const original = lightingSnapshot;
    let changed = false;
    if (Number.isFinite(original.environmentIntensity)) {
      const value = original.environmentIntensity * settings.lightingEnvironment;
      if (scene.environmentIntensity !== value) { scene.environmentIntensity = value; changed = true; }
    }
    if (Number.isFinite(original.toneMappingExposure)) {
      const value = original.toneMappingExposure * settings.lightingExposure;
      if (renderer.toneMappingExposure !== value) { renderer.toneMappingExposure = value; changed = true; }
    }
    for (const [light, intensity] of original.lights) {
      const value = intensity * settings.lightingDirect;
      if (light.intensity !== value) { light.intensity = value; changed = true; }
    }
    if (changed) manager.invalidate();
    return true;
  }

  // 白膜常用 Matcap；原站 HDRI 强度对它可能无效。只对当前白膜模型的
  // 内建受光材质做屏幕空间的中间调提亮，黑位与白位保持不变；线框材质不参与。
  function isSolidSurfaceMaterial(material) {
    if (!material || material.wireframe || !material.color || typeof material.clone !== 'function') return false;
    if (!(material.isMeshMatcapMaterial || material.isMeshStandardMaterial ||
          material.isMeshPhongMaterial || material.isMeshLambertMaterial)) return false;
    const { r, g, b } = material.color;
    return Math.min(r, g, b) >= 0.65 && Math.max(r, g, b) - Math.min(r, g, b) < 0.15;
  }

  function restoreSolidLook() {
    const snapshot = solidLookSnapshot;
    if (!snapshot) return;
    solidLookSnapshot = null;
    for (const [mesh, original, adjusted] of snapshot.assignments) {
      if (mesh.material === adjusted) mesh.material = original;
    }
    for (const material of snapshot.clones) material.dispose?.();
    snapshot.manager.invalidate();
  }

  function applySolidLook(strict = false) {
    if (!settings.brightSolid || currentMaterial().id !== 'solid') {
      restoreSolidLook();
      return false;
    }
    const canvas = findViewerCanvas();
    if (!canvas) {
      if (strict) throw new Error('白膜模型尚未加载');
      return false;
    }
    let binding;
    try { binding = findRenderContext(canvas); }
    catch (error) { if (strict) throw error; return false; }
    const { scene, manager } = binding;
    const lift = settings.solidLift;
    if (solidLookSnapshot?.scene === scene && solidLookSnapshot.lift === lift) {
      const applied = new Map(solidLookSnapshot.assignments.map(([mesh, , adjusted]) => [mesh, adjusted]));
      const visibleApplied = new Set();
      let stillCurrent = true;
      const traverseCurrent = scene.traverseVisible?.bind(scene) || scene.traverse.bind(scene);
      traverseCurrent(mesh => {
        if (!mesh.isMesh || !mesh.visible) return;
        if (applied.has(mesh)) {
          visibleApplied.add(mesh);
          if (mesh.material !== applied.get(mesh)) stillCurrent = false;
        } else if (Array.isArray(mesh.material)
          ? mesh.material.some(isSolidSurfaceMaterial) : isSolidSurfaceMaterial(mesh.material)) {
          stillCurrent = false;
        }
      });
      if (stillCurrent && visibleApplied.size === applied.size) return true;
    }
    restoreSolidLook();
    // 在最终显示色彩上提亮中间调：两端（纯黑/纯白）不动，保留
    // Matcap 明暗和叠加的独立线框。旧 gamma 曲线实测默认值仅提高约 9/255。
    const strength = (lift * 1.6).toFixed(4);
    const adjustedByOriginal = new Map();
    const assignments = [];
    const clones = new Set();
    try {
      const traverse = scene.traverseVisible?.bind(scene) || scene.traverse.bind(scene);
      traverse(mesh => {
        if (!mesh.isMesh || !mesh.visible) return;
        const original = mesh.material;
        const adjust = material => {
          if (!isSolidSurfaceMaterial(material)) return material;
          if (adjustedByOriginal.has(material)) return adjustedByOriginal.get(material);
          const clone = material.clone();
          const originalCompile = material.onBeforeCompile;
          const originalProgramKey = material.customProgramCacheKey?.() || '';
          clone.onBeforeCompile = function (shader, renderer) {
            originalCompile?.call(this, shader, renderer);
            const anchor = '#include <dithering_fragment>';
            if (!shader.fragmentShader.includes(anchor)) return;
            shader.fragmentShader = shader.fragmentShader.replace(anchor,
              `vec3 tripoSolidBase = clamp(gl_FragColor.rgb, 0.0, 1.0);\n` +
              `gl_FragColor.rgb = clamp(tripoSolidBase + ${strength} * tripoSolidBase * (1.0 - tripoSolidBase), 0.0, 1.0);\n${anchor}`);
          };
          clone.customProgramCacheKey = () => `${originalProgramKey}:tripo-bright-solid:${strength}`;
          clone.needsUpdate = true;
          adjustedByOriginal.set(material, clone);
          clones.add(clone);
          return clone;
        };
        const adjusted = Array.isArray(original) ? original.map(adjust) : adjust(original);
        if (Array.isArray(original) ? adjusted.some((item, index) => item !== original[index]) : adjusted !== original) {
          mesh.material = adjusted;
          assignments.push([mesh, original, adjusted]);
        }
      });
      if (!assignments.length) {
        for (const material of clones) material.dispose?.();
        if (strict) throw new Error('未找到可调整的白膜材质；已保留原站画面');
        return false;
      }
      solidLookSnapshot = { scene, manager, lift, assignments, clones };
      manager.invalidate();
      return true;
    } catch (error) {
      for (const [mesh, original, adjusted] of assignments) {
        if (mesh.material === adjusted) mesh.material = original;
      }
      for (const material of clones) material.dispose?.();
      if (strict) throw error;
      return false;
    }
  }

  function cameraSignature(camera) {
    camera.updateMatrixWorld(true);
    return [...camera.matrixWorld.elements, ...camera.projectionMatrix.elements];
  }

  function assertSignature(actual, expected, label) {
    if (!expected || actual.length !== expected.length || actual.some((value, i) =>
      !Number.isFinite(value) || !Number.isFinite(expected[i]) ||
      Math.abs(value - expected[i]) > 1e-9 * Math.max(1, Math.abs(expected[i])))) {
      throw new Error(`${label}不一致，已中止以避免导出错帧`);
    }
  }

  function snapshotView(binding) {
    const { controls, camera, canvas } = binding;
    const spherical = controls.getSpherical(undefined, false);
    return {
      position: controls.getPosition(undefined, false).toArray(),
      target: controls.getTarget(undefined, false).toArray(),
      offset: controls.getFocalOffset(undefined, false).toArray(),
      theta: spherical.theta, phi: spherical.phi, zoom: camera.zoom,
      width: canvas.width, height: canvas.height,
      signature: cameraSignature(camera),
    };
  }

  function applyView(binding, view, angle = 0) {
    const { controls, camera, canvas } = binding;
    if (!canvas.isConnected || canvas.width !== view.width || canvas.height !== view.height ||
        unref(binding.context.camera.activeCamera) !== camera || unref(binding.context.scene) !== binding.scene) {
      throw new Error('预览器尺寸、相机或工程已变化，请保持窗口尺寸不变后重新导出');
    }
    // All targets are absolute, transition=false. Never integrate pointer deltas
    // or wall-clock time, including when encoding/GPU work takes longer.
    controls.setLookAt(...view.position, ...view.target, false);
    controls.setFocalOffset(...view.offset, false);
    controls.zoomTo(view.zoom, false);
    controls.rotateTo(view.theta + angle, view.phi, false);
    controls.update(0);
    // camera-controls 2.10.x uses camera.matrix for screen-space focal offset.
    // Refresh that basis before applying the offset at a new absolute angle.
    camera.updateMatrixWorld(true);
    controls.update(0);
    const spherical = controls.getSpherical(undefined, false);
    if (Math.abs(spherical.theta - view.theta - angle) > 1e-8 ||
        Math.abs(spherical.phi - view.phi) > 1e-8) {
      throw new Error('相机角度受到页面限制，不能保证精确圈数');
    }
    return cameraSignature(camera);
  }

  function createFrameLock(canvas, initialView = null) {
    const binding = findRenderContext(canvas);
    const { controls, renderer, manager, scene, camera } = binding;
    const view = initialView || snapshotView(binding);
    const originalEnabled = controls.enabled;
    const originalRender = renderer.render;
    const transparent = Boolean(settings.transparentOutput);
    if (transparent && renderer.getContext().getContextAttributes()?.alpha !== true) {
      throw new Error('当前模型 Canvas 不支持 Alpha，无法可靠导出透明背景；请关闭透明选项。');
    }
    const originalBackground = transparent ? scene.background : null;
    const originalClearAlpha = transparent ? renderer.getClearAlpha() : null;
    const applyTransparency = () => {
      if (!transparent) return;
      scene.background = null;
      renderer.setClearAlpha(0);
      // Preserve scene.environment: it lights the model, not the background.
    };
    let pending = null;
    let released = false;
    let backgrounded = document.hidden;
    let beforeHook, renderHook;
    const clearDeadline = (job) => {
      clearTimeout(job.timer);
      job.timer = null;
      job.timerEpoch = (job.timerEpoch || 0) + 1;
    };
    const fail = (error) => {
      if (!pending) return;
      const job = pending;
      pending = null;
      clearDeadline(job);
      job.reject(error);
    };
    const requestRender = () => {
      if (!pending || released) return;
      try {
        if (manager.mode === 'manual') manager.advance();
        else manager.invalidate();
      } catch (error) { fail(error); }
    };
    const armDeadline = () => {
      if (!pending || document.hidden) return;
      const job = pending;
      clearDeadline(job);
      const epoch = job.timerEpoch;
      job.timer = window.setTimeout(() => {
        if (pending !== job || epoch !== job.timerEpoch || released) return;
        // Visibility events and timer callbacks can be delivered in either order.
        // A hidden document must never consume the foreground render deadline.
        if (document.hidden) { visibilityChanged(); return; }
        fail(new Error('等待原生渲染完成超时（前台15秒），未生成重复帧'));
      }, 15000);
    };
    const visibilityChanged = () => {
      if (released) return;
      const wasBackgrounded = backgrounded;
      backgrounded = document.hidden;
      if (!pending) return;
      if (backgrounded) {
        clearDeadline(pending);
        if (!wasBackgrounded) setStatus('后台导出 · 有新渲染帧就继续，浏览器挂起时保留进度等待', 'warning');
      } else if (wasBackgrounded) {
        pending.armed = false;
        pending.observed = false;
        setStatus('已返回前台 · 正在继续未完成的帧', 'running');
        armDeadline();
        requestRender();
      }
    };
    const wrappedRender = function (renderScene, renderCamera, ...args) {
      if (pending?.armed && renderScene === scene && renderCamera === camera) {
        try {
          applyTransparency();
          assertSignature(cameraSignature(camera), pending.signature, '渲染时相机');
          pending.observed = true;
        } catch (error) { fail(error); }
      }
      return originalRender.call(this, renderScene, renderCamera, ...args);
    };
    const release = () => {
      if (released) return;
      released = true;
      fail(new Error('逐帧采集已取消'));
      document.removeEventListener('visibilitychange', visibilityChanged);
      beforeHook?.off();
      renderHook?.off();
      if (renderer.render === wrappedRender) renderer.render = originalRender;
      controls.enabled = originalEnabled;
      if (transparent) {
        scene.background = originalBackground;
        renderer.setClearAlpha(originalClearAlpha);
        manager.invalidate();
      }
    };
    try {
      controls.stop();
      applyTransparency();
      controls.enabled = false;
      const startSignature = applyView(binding, view);
      assertSignature(startSignature, view.signature, '起始视角');
      renderer.render = wrappedRender;
      document.addEventListener('visibilitychange', visibilityChanged);
      beforeHook = manager.loop.onBeforeLoop(() => {
        if (!pending) return;
        try {
          pending.armed = false;
          pending.observed = false;
          applyTransparency();
          pending.signature = applyView(binding, view, pending.angle);
          pending.armed = true;
        } catch (error) { fail(error); }
      });
      renderHook = manager.onRender(() => {
        if (!pending?.armed || !pending.observed) return;
        const job = pending;
        try {
          assertSignature(cameraSignature(camera), job.signature, '取图时相机');
          // Copy *inside* the render-complete callback, before WebGL discards its
          // drawing buffer. No await, rAF or encoder backpressure before this copy.
          const result = job.copy(job.signature);
          pending = null;
          clearDeadline(job);
          job.resolve(result);
        } catch (error) { fail(error); }
      });
    } catch (error) { release(); throw error; }
    return {
      view, binding, release,
      restore() { applyView(binding, view); },
      capture(angle, copy) {
        if (released || pending) return Promise.reject(new Error('逐帧任务必须串行执行'));
        return new Promise((resolve, reject) => {
          pending = { angle, copy, resolve, reject, observed: false, armed: false,
            signature: null, timer: null, timerEpoch: 0 };
          backgrounded = document.hidden;
          armDeadline();
          requestRender();
        });
      },
    };
  }

  function requireCanvasRecording() {
    if (settings.recordingScope !== 'canvas') {
      throw new Error('严格逐帧录制目前仅支持“仅模型画面”；整标签页共享流无法确认帧与角度对应，已暂停此录制方式');
    }
  }

  function checkFrameEntry() {
    try {
      const canvas = findViewerCanvas();
      if (!canvas) throw new Error('请先打开一个已加载的模型');
      const binding = findRenderContext(canvas);
      const view = snapshotView(binding);
      setStatus(`逐帧入口可用 · ${view.width}×${view.height} · 原生相机与渲染完成回调`, 'ready', true);
      console.info('[Tripo Rotation] 逐帧入口诊断', {
        version: SCRIPT_VERSION, engine: canvas.dataset.engine, tres: canvas.dataset.tres,
        controls: canvas.dataset.cameraControlsVersion, renderMode: binding.manager.mode,
        camera: binding.camera.type, width: view.width, height: view.height,
      });
    } catch (error) { setStatus(`逐帧入口检查失败：${error.message}`, 'error'); }
  }

  function normalizeSettings(candidate) {
    const source = candidate && typeof candidate === 'object' ? candidate : {};
    const number = (key, min, max) => clamp(source[key], min, max, DEFAULTS[key]);
    const boolean = (key) => typeof source[key] === 'boolean' ? source[key] : DEFAULTS[key];
    const validExportKeys = new Set(EXPORT_ITEMS.map(item => item.key));
    const batchItems = Array.isArray(source.batchItems)
      ? [...new Set(source.batchItems.filter(key => validExportKeys.has(key)))]
      : [...DEFAULTS.batchItems];

    return {
      ...DEFAULTS,
      configVersion: DEFAULTS.configVersion,
      direction: Number(source.direction) === 1 ? 1 : DEFAULTS.direction,
      pixelsPerTurnRatio: number('pixelsPerTurnRatio', 0.2, 3),
      uniformTurns: Math.round(number('uniformTurns', 1, 20)),
      uniformDuration: number('uniformDuration', 0.5, 30),
      transitionTurns: number('transitionTurns', 0.25, 20),
      accelerationDuration: number('accelerationDuration', 0.05, 20),
      cruiseDuration: number('cruiseDuration', 0, 60),
      decelerationDuration: number('decelerationDuration', 0.05, 20),
      countdown: number('countdown', 0, 10),
      settleDuration: number('settleDuration', 0, 5),
      autoHide: boolean('autoHide'),
      recordEnabled: boolean('recordEnabled'),
      recordingScope: source.recordingScope === 'tab' ? 'tab' : DEFAULTS.recordingScope,
      recordingFps: number('recordingFps', 15, 120),
      videoBitrateMbps: number('videoBitrateMbps', 0, 200),
      showAxisInOutput: boolean('showAxisInOutput'),
      transparentOutput: boolean('transparentOutput'),
      batchItems: batchItems.length ? batchItems : [...DEFAULTS.batchItems],
      batchWireframeVariants: boolean('batchWireframeVariants'),
      studioLighting: boolean('studioLighting'),
      lightingEnvironment: number('lightingEnvironment', 0, 3),
      lightingDirect: number('lightingDirect', 0, 3),
      lightingExposure: number('lightingExposure', 0.5, 2),
      brightSolid: boolean('brightSolid'),
      solidLift: number('solidLift', 0, 1),
    };
  }

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn(`[Tripo Rotation] 无法读取本地设置 ${key}`, error);
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      console.warn(`[Tripo Rotation] 无法写入本地设置 ${key}`, error);
      return false;
    }
  }

  function loadSettings() {
    try {
      const stored = JSON.parse(readStorage(STORAGE_KEY) || '{}');
      return normalizeSettings(stored);
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSettings() {
    const saved = writeStorage(STORAGE_KEY, JSON.stringify(settings));
    if (!saved) {
      if (ui?.status) setStatus('设置无法持久化，当前会话仍会继续使用', 'warning');
    }
    return saved;
  }

  function currentProjectId() {
    const match = location.pathname.match(/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
    return match?.[1] || location.pathname.split('/').filter(Boolean).pop() || 'unknown-project';
  }

  function loadProjectNames() {
    try {
      const names = JSON.parse(readStorage(PROJECT_NAMES_KEY) || '{}');
      return names && typeof names === 'object' ? names : {};
    } catch {
      return {};
    }
  }

  function getProjectName() {
    return String(loadProjectNames()[currentProjectId()] || '').trim();
  }

  function saveProjectName(name) {
    const value = String(name || '').trim();
    if (!value) return false;
    const names = loadProjectNames();
    names[currentProjectId()] = value;
    writeStorage(PROJECT_NAMES_KEY, JSON.stringify(names));
    rememberNamedProject(value);
    if (ui?.projectName) ui.projectName.value = value;
    return true;
  }

  function validProjectUrl(value, id) {
    try {
      const url = new URL(value);
      if (url.origin !== 'https://studio.tripo3d.ai' || url.username || url.password) return null;
      const match = url.pathname.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?workspace\/generate\/[^/]*?([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
      if (!match || match[1].toLowerCase() !== String(id).toLowerCase()) return null;
      return `${url.origin}${url.pathname}`;
    } catch { return null; }
  }

  function loadProjectLibrary() {
    try {
      const records = JSON.parse(readStorage(PROJECT_LIBRARY_KEY) || '[]');
      if (!Array.isArray(records)) return [];
      return records.filter(record => record && typeof record.name === 'string' && record.name.trim() &&
        validProjectUrl(record.url, record.id)).sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    } catch { return []; }
  }

  function rememberNamedProject(name) {
    const id = currentProjectId();
    const url = validProjectUrl(location.href, id);
    if (!url) return;
    const records = loadProjectLibrary().filter(record => record.id !== id);
    records.unshift({ id, name, url, updatedAt: Date.now() });
    writeStorage(PROJECT_LIBRARY_KEY, JSON.stringify(records));
  }

  function projectSwitchBlocked() {
    return Boolean(exportBusy || batchRunning || activeRun || pendingSave || pendingProjectName || pendingBatchStart);
  }

  function switchNamedProject(id) {
    if (projectSwitchBlocked()) {
      setStatus('导出、保存或命名尚未结束，暂时不能切换工程', 'warning');
      return;
    }
    const record = loadProjectLibrary().find(item => item.id === id);
    const url = record && validProjectUrl(record.url, id);
    if (!url || id === currentProjectId()) return;
    location.assign(url);
  }

  function renderProjectLibrary() {
    const query = ui.projectSearch.value.trim().toLocaleLowerCase();
    const records = loadProjectLibrary().filter(record =>
      `${record.name} ${record.id}`.toLocaleLowerCase().includes(query));
    ui.projectList.replaceChildren();
    for (const record of records) {
      const button = document.createElement('button');
      button.className = 'project-entry';
      const name = document.createElement('span');
      name.textContent = record.name;
      const detail = document.createElement('small');
      detail.textContent = `${record.id.slice(0, 8)}${record.id === currentProjectId() ? ' · 当前项目' : ''}`;
      button.append(name, detail);
      button.disabled = projectSwitchBlocked() || record.id === currentProjectId();
      button.addEventListener('click', () => switchNamedProject(record.id));
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px';
      button.style.flex = '1';
      const remove = document.createElement('button');
      remove.textContent = '删除命名';
      remove.setAttribute('aria-label', `删除命名：${record.name}`);
      remove.disabled = projectSwitchBlocked();
      remove.addEventListener('click', () => deleteProjectName(record.id));
      row.append(button, remove);
      ui.projectList.appendChild(row);
    }
    if (!records.length) {
      const empty = document.createElement('p');
      empty.className = 'note';
      empty.textContent = query ? '没有匹配的项目' : '暂无记录。新版命名或改名后，项目会显示在这里。';
      ui.projectList.appendChild(empty);
    }
  }

  function deleteProjectName(id) {
    if (projectSwitchBlocked()) return;
    if (!window.confirm('仅删除本浏览器保存的项目命名，不会删除 Tripo 工程或已导出的文件。继续？')) return;
    const names = loadProjectNames();
    delete names[id];
    writeStorage(PROJECT_NAMES_KEY, JSON.stringify(names));
    writeStorage(PROJECT_LIBRARY_KEY, JSON.stringify(loadProjectLibrary().filter(record => record.id !== id)));
    syncProjectNameField();
    renderProjectLibrary();
  }

  function showProjectLibrary(show) {
    if (show && projectSwitchBlocked()) {
      setStatus('请先完成或停止当前任务，再切换工程', 'warning');
      return;
    }
    ui.mainPage.hidden = show;
    ui.projectsPage.hidden = !show;
    ui.batchMenu.hidden = true;
    ui.batchToggle.setAttribute('aria-expanded', 'false');
    if (show) { renderProjectLibrary(); ui.projectSearch.focus(); }
  }

  function selectedExportItems() {
    const keys = Array.isArray(settings.batchItems) ? settings.batchItems : DEFAULTS.batchItems;
    return EXPORT_ITEMS.filter(item => keys.includes(item.key));
  }

  function imageBasename(image) {
    const source = image?.currentSrc || image?.src || '';
    try {
      const pathname = new URL(source, location.href).pathname;
      return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1)).toLowerCase();
    } catch {
      return source.split(/[?#]/, 1)[0].slice(source.lastIndexOf('/') + 1).toLowerCase();
    }
  }

  function findButtonWithIcon(icon) {
    const wanted = String(icon).toLowerCase();
    const image = [...document.querySelectorAll('button img')].find(
      item => imageBasename(item) === wanted
    );
    return image?.closest('button') || null;
  }

  function findWireframeButton() {
    return findButtonWithIcon('wireframe.png');
  }

  function toggleIsOn(button) {
    return Boolean(button && (button.getAttribute('aria-pressed') === 'true' || button.dataset.state === 'on'));
  }

  function wireframeAvailable() {
    const button = findWireframeButton();
    return Boolean(button && button.isConnected && !button.disabled);
  }

  function plannedExportItems() {
    const selected = selectedExportItems();
    const includeWireframe = settings.batchWireframeVariants && wireframeAvailable();
    return selected.flatMap(item => includeWireframe
      ? [{ ...item, wireframe: false }, { ...item, wireframe: true }]
      : [{ ...item, wireframe: false }]);
  }

  function syncBatchSelection() {
    const selected = selectedExportItems();
    const available = wireframeAvailable();
    const total = selected.length * (settings.batchWireframeVariants && available ? 2 : 1);
    ui.exportAll.textContent = `一键导出（${total}个文件）`;
    ui.exportAll.disabled = !selected.length;
    for (const checkbox of ui.batchMenu.querySelectorAll('input[data-export-key]')) {
      checkbox.checked = selected.some(item => item.key === checkbox.dataset.exportKey);
    }
    if (ui.batchWireframe) {
      ui.batchWireframe.checked = Boolean(settings.batchWireframeVariants);
      ui.batchWireframe.disabled = !available || projectSwitchBlocked();
      ui.batchWireframeText.textContent = available ? '同时导出线框版本' : '当前项目未检测到线框模式';
    }
  }

  function initializeBatchMenu() {
    const wireframeLabel = document.createElement('label');
    wireframeLabel.className = 'batch-wireframe';
    const wireframeInput = document.createElement('input');
    wireframeInput.type = 'checkbox';
    wireframeInput.dataset.wireframeVariants = 'true';
    const wireframeText = document.createElement('span');
    wireframeLabel.append(wireframeInput, wireframeText);
    ui.batchMenu.appendChild(wireframeLabel);
    ui.batchWireframe = wireframeInput;
    ui.batchWireframeText = wireframeText;
    for (const kind of EXPORT_KINDS) {
      const row = document.createElement('div');
      row.className = 'batch-row';
      const title = document.createElement('span');
      title.textContent = kind.label;
      row.appendChild(title);
      for (const material of MATERIALS) {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.dataset.exportKey = `${kind.id}:${material.id}`;
        input.setAttribute('aria-label', `${kind.label} · ${material.label}`);
        label.append(input, document.createTextNode(material.label));
        row.appendChild(label);
      }
      ui.batchMenu.appendChild(row);
    }
    ui.batchMenu.addEventListener('change', event => {
      if (!event.target.matches('input[data-export-key], input[data-wireframe-variants]')) return;
      if (projectSwitchBlocked()) { syncBatchSelection(); return; }
      if (event.target.matches('input[data-wireframe-variants]')) {
        settings.batchWireframeVariants = event.target.checked && wireframeAvailable();
      } else {
        settings.batchItems = [...ui.batchMenu.querySelectorAll('input[data-export-key]:checked')].map(input => input.dataset.exportKey);
      }
      saveSettings();
      syncBatchSelection();
    });
    syncBatchSelection();
  }

  function safeFilenamePart(value) {
    return String(value || '')
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/[. ]+$/g, '') || '未命名工程';
  }

  function currentMaterial() {
    for (const material of MATERIALS) {
      const button = findButtonWithIcon(material.icon);
      if (button?.getAttribute('aria-pressed') === 'true' || button?.dataset.state === 'on') {
        return material;
      }
    }
    return { id: 'current', label: '当前材质', icon: '' };
  }

  function buildOutputFilename(kind, projectName, materialLabel, wireframe = false) {
    const project = safeFilenamePart(projectName);
    const material = `${safeFilenamePart(materialLabel)}${wireframe ? '-线框' : ''}`;
    if (kind === 'screenshot') return `${project}-单帧-${material}.png`;
    if (kind === 'uniform') {
      return `${project}-匀速圈（圈数${settings.uniformTurns}）-${material}.${settings.transparentOutput ? 'mov' : 'mp4'}`;
    }
    return `${project}-转场-${material}.${settings.transparentOutput ? 'mov' : 'mp4'}`;
  }

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width >= 320 && rect.height >= 240 &&
      style.display !== 'none' && style.visibility !== 'hidden' &&
      Number(style.opacity) > 0 && style.pointerEvents !== 'none';
  }

  function findViewerCanvas() {
    const preferred = [...document.querySelectorAll(
      'canvas[data-camera-controls-version][data-engine^="three.js"]'
    )].filter(isVisible);

    const candidates = preferred.length ? preferred :
      [...document.querySelectorAll('canvas')].filter(isVisible);

    return candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return br.width * br.height - ar.width * ar.height;
    })[0] || null;
  }

  function autoBitrate(width, height, fps) {
    // 约 0.22 bit / pixel / frame；兼顾细节与 AE 后期空间。
    return Math.round(clamp(width * height * fps * 0.22, 8_000_000, 120_000_000, 40_000_000));
  }

  function timestampForFile() {
    const now = new Date();
    const two = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-` +
      `${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  }

  function downloadVideo(blob, session, mode, cancelled = false) {
    const suffix = cancelled ? '-stopped' : '';
    const filename = `tripo-${mode}-${timestampForFile()}-${session.width}x${session.height}-` +
      `${session.fps}fps${suffix}.${session.format === 'mov' ? 'mov' : 'mp4'}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return filename;
  }

  function downloadScreenshot(blob, source, scope) {
    const filename = `tripo-screenshot-${timestampForFile()}-${source.width}x${source.height}-${scope}.png`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return filename;
  }

  function fallbackDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return filename;
  }

  function withStoppedSuffix(filename) {
    const dot = filename.lastIndexOf('.');
    return dot > 0
      ? `${filename.slice(0, dot)}-已停止${filename.slice(dot)}`
      : `${filename}-已停止`;
  }

  async function chooseSingleFile(filename, type) {
    if (typeof window.showSaveFilePicker !== 'function') return { kind: 'download' };
    const isPng = type === 'image/png';
    const isMov = type === 'video/quicktime';
    const handle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{
        description: isPng ? 'PNG 图片' : isMov ? '透明 MOV（无损 PNG 帧）' : 'H.264 MP4 视频',
        accept: { [type]: [isPng ? '.png' : isMov ? '.mov' : '.mp4'] },
      }],
      excludeAcceptAllOption: false,
    });
    return { kind: 'file', handle };
  }

  async function uniqueDirectoryFile(directory, filename) {
    const dot = filename.lastIndexOf('.');
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const extension = dot > 0 ? filename.slice(dot) : '';
    for (let index = 1; index < 1000; index += 1) {
      const candidate = index === 1 ? filename : `${stem}（${index}）${extension}`;
      try {
        await directory.getFileHandle(candidate);
      } catch (error) {
        if (error?.name === 'NotFoundError') {
          return {
            filename: candidate,
            handle: await directory.getFileHandle(candidate, { create: true }),
          };
        }
        throw error;
      }
    }
    throw new Error('同名文件数量过多');
  }

  async function directoryEntryNames(directory) {
    const names = new Set();
    if (typeof directory?.keys !== 'function') return names;
    for await (const name of directory.keys()) names.add(name);
    return names;
  }

  function isSwapFor(filename, name) {
    const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}(?:\\.\\d+)?\\.crswap$`, 'i').test(name);
  }

  async function reserveDirectoryFile(job) {
    if (job.directoryReservation) return job.directoryReservation;
    const directory = job.target.handle;
    const namesBefore = await directoryEntryNames(directory);
    const unique = await uniqueDirectoryFile(directory, job.filename);
    job.directoryReservation = {
      directory,
      filename: unique.filename,
      handle: unique.handle,
      namesBefore,
    };
    return job.directoryReservation;
  }

  async function cleanupDirectoryReservation(job, preserveTarget) {
    const reservation = job.directoryReservation;
    if (!reservation) return;
    const { directory, filename, handle, namesBefore } = reservation;
    try {
      const namesNow = await directoryEntryNames(directory);
      if (typeof directory.removeEntry === 'function') {
        for (const name of namesNow) {
          if (!namesBefore.has(name) && isSwapFor(filename, name)) {
            try { await directory.removeEntry(name); }
            catch (error) { console.warn(`[Tripo Rotation] 无法清理临时文件 ${name}`, error); }
          }
        }
        if (!preserveTarget && !namesBefore.has(filename)) {
          try {
            const file = await handle.getFile();
            // Never delete a non-empty target: another process may have replaced it.
            if (file.size === 0) await directory.removeEntry(filename);
          } catch (error) {
            if (error?.name !== 'NotFoundError') console.warn(`[Tripo Rotation] 无法清理占位文件 ${filename}`, error);
          }
        }
      }
    } finally {
      if (!preserveTarget) job.directoryReservation = null;
    }
  }

  async function writeBlobOnce(job) {
    if (!job.target || job.target.kind === 'download') {
      job.stage = '交给浏览器下载';
      return fallbackDownload(job.blob, job.filename);
    }
    let writable = null;
    let handle = job.target.handle;
    job.actualFilename = handle?.name || job.filename;
    try {
      job.stage = '取得目标文件';
      if (job.target.kind === 'directory') {
        // Reserve a unique name once. A transient close/commit failure must retry
        // this same target, otherwise every retry leaves a zero-byte file and a
        // complete .crswap behind, then unnecessarily creates “（2）”.
        const reservation = await reserveDirectoryFile(job);
        handle = reservation.handle;
        job.actualFilename = reservation.filename;
      }
      job.stage = '创建写入流';
      writable = await handle.createWritable();
      job.stage = '写入文件内容';
      await writable.write(job.blob);
      job.stage = '提交文件（关闭写入流）';
      await writable.close();
      if (typeof handle.getFile === 'function') {
        const saved = await handle.getFile();
        if (saved.size !== job.blob.size) {
          throw Object.assign(new Error(`保存后大小不一致：${saved.size}/${job.blob.size}`), { name: 'InvalidStateError' });
        }
      }
      job.stage = '保存完成';
      await cleanupDirectoryReservation(job, job.target.kind === 'directory');
      return job.actualFilename;
    } catch (error) {
      job.error = error;
      console.error(`[Tripo Rotation] 保存失败 [${job.stage}] ${job.actualFilename}`, error);
      // 失败操作已经返回后才中止并重试；绝不让两个写入流并发提交同一文件。
      if (writable) {
        try { await writable.abort(); } catch (abortError) {
          console.warn('[Tripo Rotation] 写入流已关闭或无法中止', abortError);
        }
      }
      throw error;
    }
  }

  async function attemptSave(job) {
    const transientErrors = new Set(['InvalidStateError', 'UnknownError', 'NotReadableError', 'NoModificationAllowedError']);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await writeBlobOnce(job);
      } catch (error) {
        // 单独选择的文件不自动覆盖重试，留给用户显式选择重试或另存为。
        if (job.target?.kind !== 'directory' || !transientErrors.has(error?.name) || attempt === 4) throw error;
        const delay = [1000, 2000, 4000, 8000][attempt];
        setStatus(`文件提交被占用，${delay / 1000}秒后按原文件名重试 ${attempt + 1}/4：${job.actualFilename}`, 'warning');
        await sleep(delay);
      }
    }
  }

  function showSaveRecovery(job) {
    ui.saveRecoveryModal.hidden = false;
    ui.saveRecoveryInfo.textContent = `${job.filename}\n失败阶段：${job.stage}\n${job.error?.name || 'Error'}：${job.error?.message || '未知错误'}\n已编码文件仍保留在本页内存中。保存成功后自动继续，无需重新录制。请勿刷新或关闭页面。`;
    ui.saveRetry.disabled = job.busy;
    ui.saveAs.disabled = job.busy;
    ui.saveDiscard.disabled = job.busy;
    setStatus(`导出已暂停，等待保存：${job.filename}（${job.stage}）`, 'error');
  }

  async function saveBlob(blob, filename, target = null) {
    const job = { blob, filename, target, stage: '准备保存', error: null, busy: false };
    try {
      return await attemptSave(job);
    } catch (error) {
      job.error = error;
      // 暂停原有 await 链，保留同一个 Blob；成功保存后从此处继续批量队列。
      return await new Promise((resolve, reject) => {
        job.resolve = resolve;
        job.reject = reject;
        pendingSave = job;
        showSaveRecovery(job);
      });
    }
  }

  async function resumePendingSave(saveAs = false) {
    const job = pendingSave;
    if (!job || job.busy) return;
    job.busy = true;
    showSaveRecovery(job);
    try {
      if (saveAs) {
        // 在按钮点击的用户激活期间调用系统保存框，不重新编码。
        const target = await chooseSingleFile(job.filename, job.blob.type);
        job.target = target;
      }
      const filename = await attemptSave(job);
      if (saveAs) await cleanupDirectoryReservation(job, false);
      pendingSave = null;
      ui.saveRecoveryModal.hidden = true;
      job.resolve(filename);
    } catch (error) {
      // 取消另存为只回到恢复窗口，不能取消整批任务或释放已编码数据。
      if (error?.name !== 'AbortError') job.error = error;
    } finally {
      job.busy = false;
      if (pendingSave === job) showSaveRecovery(job);
    }
  }

  function discardPendingSave() {
    const job = pendingSave;
    if (!job || job.busy) return;
    if (!window.confirm('放弃当前尚未保存的文件并终止本次导出？已保存文件不会删除。')) return;
    pendingSave = null;
    ui.saveRecoveryModal.hidden = true;
    cleanupDirectoryReservation(job, false).catch(error => console.warn('[Tripo Rotation] 清理未完成保存失败', error));
    job.reject(new Error('用户放弃当前文件，导出已终止'));
  }

  function findViewerBackground(sourceCanvas) {
    let element = sourceCanvas.parentElement;
    while (element && element !== document.body) {
      const style = getComputedStyle(element);
      if (style.backgroundImage !== 'none' ||
          (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)')) {
        return style;
      }
      element = element.parentElement;
    }
    return null;
  }

  function paintViewerBackground(context, width, height, sourceCanvas) {
    const style = findViewerBackground(sourceCanvas);
    const image = style?.backgroundImage || '';
    const colors = image.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/gi) || [];

    if (image.includes('radial-gradient') && colors.length >= 2) {
      const radius = Math.hypot(width / 2, height / 2);
      const gradient = context.createRadialGradient(
        width / 2, height / 2, 0,
        width / 2, height / 2, radius
      );
      gradient.addColorStop(0, colors[0]);
      gradient.addColorStop(0.9, colors[colors.length - 1]);
      gradient.addColorStop(1, colors[colors.length - 1]);
      context.fillStyle = gradient;
    } else {
      const color = style?.backgroundColor;
      context.fillStyle = color && color !== 'rgba(0, 0, 0, 0)'
        ? color
        : '#0e0e10';
    }
    context.fillRect(0, 0, width, height);
  }

  function findAxisOverlay(sourceCanvas) {
    const container = sourceCanvas.parentElement;
    if (!container) return null;
    const exact = container.querySelector(
      'div[style*="height: 72px"][style*="width: 72px"][style*="right: 0px"][style*="top: 0px"]'
    );
    if (exact) return exact;

    const canvasRect = sourceCanvas.getBoundingClientRect();
    return [...container.querySelectorAll('div')].find((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.position === 'absolute' && rect.width >= 48 && rect.width <= 120 &&
        rect.height >= 48 && rect.height <= 120 &&
        rect.right > canvasRect.right - 140 && rect.top < canvasRect.top + 140;
    }) || null;
  }

  function createViewerBackgroundCanvas(sourceCanvas) {
    const backgroundCanvas = document.createElement('canvas');
    backgroundCanvas.width = sourceCanvas.width;
    backgroundCanvas.height = sourceCanvas.height;
    paintViewerBackground(
      backgroundCanvas.getContext('2d', { alpha: false }),
      backgroundCanvas.width,
      backgroundCanvas.height,
      sourceCanvas
    );
    return backgroundCanvas;
  }

  function maskAxisInCanvasOutput(context, outputCanvas, sourceCanvas, backgroundCanvas) {
    if (settings.showAxisInOutput) return;
    const overlay = findAxisOverlay(sourceCanvas);
    if (!overlay) return;
    const canvasRect = sourceCanvas.getBoundingClientRect();
    const axisRect = overlay.getBoundingClientRect();
    const scaleX = outputCanvas.width / canvasRect.width;
    const scaleY = outputCanvas.height / canvasRect.height;
    const padding = 3;
    const x = Math.max(0, Math.floor((axisRect.left - canvasRect.left - padding) * scaleX));
    const y = Math.max(0, Math.floor((axisRect.top - canvasRect.top - padding) * scaleY));
    const width = Math.min(outputCanvas.width - x, Math.ceil((axisRect.width + padding * 2) * scaleX));
    const height = Math.min(outputCanvas.height - y, Math.ceil((axisRect.height + padding * 2) * scaleY));
    if (settings.transparentOutput) context.clearRect(x, y, width, height);
    else context.drawImage(backgroundCanvas, x, y, width, height, x, y, width, height);
  }

  function maskAxisInTabOutput(context, outputCanvas, sourceCanvas, backgroundCanvas) {
    if (settings.showAxisInOutput) return;
    const overlay = findAxisOverlay(sourceCanvas);
    if (!overlay) return;
    const canvasRect = sourceCanvas.getBoundingClientRect();
    const axisRect = overlay.getBoundingClientRect();
    const viewportScaleX = outputCanvas.width / window.innerWidth;
    const viewportScaleY = outputCanvas.height / window.innerHeight;
    const sourceScaleX = backgroundCanvas.width / canvasRect.width;
    const sourceScaleY = backgroundCanvas.height / canvasRect.height;
    const padding = 3;
    const relativeX = axisRect.left - canvasRect.left - padding;
    const relativeY = axisRect.top - canvasRect.top - padding;
    const cssWidth = axisRect.width + padding * 2;
    const cssHeight = axisRect.height + padding * 2;
    context.drawImage(
      backgroundCanvas,
      relativeX * sourceScaleX,
      relativeY * sourceScaleY,
      cssWidth * sourceScaleX,
      cssHeight * sourceScaleY,
      (axisRect.left - padding) * viewportScaleX,
      (axisRect.top - padding) * viewportScaleY,
      cssWidth * viewportScaleX,
      cssHeight * viewportScaleY
    );
  }

  function createCanvasFrameSource(sourceCanvas, evenDimensions = true) {
    const transparent = Boolean(settings.transparentOutput);
    const recordingCanvas = document.createElement('canvas');
    // WebCodecs H.264 需要偶数尺寸，最多仅裁掉右侧/底部各 1 像素。
    recordingCanvas.width = evenDimensions
      ? Math.max(2, sourceCanvas.width - sourceCanvas.width % 2)
      : sourceCanvas.width;
    recordingCanvas.height = evenDimensions
      ? Math.max(2, sourceCanvas.height - sourceCanvas.height % 2)
      : sourceCanvas.height;
    const context = recordingCanvas.getContext('2d', {
      alpha: transparent,
      desynchronized: true,
    });
    const backgroundCanvas = transparent ? null : createViewerBackgroundCanvas(sourceCanvas);

    const drawFrame = () => {
      if (transparent) context.clearRect(0, 0, recordingCanvas.width, recordingCanvas.height);
      else context.drawImage(backgroundCanvas, 0, 0, recordingCanvas.width, recordingCanvas.height);
      context.drawImage(sourceCanvas, 0, 0, recordingCanvas.width, recordingCanvas.height);
      if (transparent) {
        const pixels = context.getImageData(0, 0, recordingCanvas.width, recordingCanvas.height).data;
        let hasTransparency = false, hasModel = false;
        for (let i = 3; i < pixels.length; i += 4) {
          if (pixels[i] < 255) hasTransparency = true;
          if (pixels[i] > 0) hasModel = true;
        }
        if (!hasTransparency || !hasModel) throw new Error('原生渲染没有提供有效透明模型帧（可能被后期效果填实）。已停止，避免输出伪透明文件。');
      }
      maskAxisInCanvasOutput(context, recordingCanvas, sourceCanvas, backgroundCanvas);
    };
    // 先绘制静态首帧，避免编码器取得空白画面。
    if (!transparent) drawFrame();

    return {
      canvas: recordingCanvas,
      width: recordingCanvas.width,
      height: recordingCanvas.height,
      drawFrame,
      cleanup: () => {},
    };
  }

  async function createTabCapture(fps) {
      setStatus('请选择“当前标签页”作为画面来源…', 'countdown');
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: fps, max: fps },
          cursor: 'never',
        },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
      });
      const track = stream.getVideoTracks()[0];
      const trackSettings = track?.getSettings?.() || {};
      if (track) track.contentHint = 'detail';
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();

      return {
        stream,
        video,
        trackSettings,
        cleanup: () => {
          video.pause();
          video.srcObject = null;
          for (const mediaTrack of stream.getTracks()) mediaTrack.stop();
        },
      };
  }

  async function createTabFrameSource(fps, sourceCanvas, sharedCapture = null) {
      const capture = sharedCapture || await createTabCapture(fps);
      const { video, trackSettings } = capture;

      const rawWidth = Math.floor(Number(trackSettings.width) || video.videoWidth || window.innerWidth);
      const rawHeight = Math.floor(Number(trackSettings.height) || video.videoHeight || window.innerHeight);
      const recordingCanvas = document.createElement('canvas');
      recordingCanvas.width = Math.max(2, rawWidth - rawWidth % 2);
      recordingCanvas.height = Math.max(2, rawHeight - rawHeight % 2);
      const context = recordingCanvas.getContext('2d', { alpha: false, desynchronized: true });
      const backgroundCanvas = createViewerBackgroundCanvas(sourceCanvas);
      const drawFrame = () => {
        context.drawImage(video, 0, 0, recordingCanvas.width, recordingCanvas.height);
        maskAxisInTabOutput(context, recordingCanvas, sourceCanvas, backgroundCanvas);
      };
      return {
        canvas: recordingCanvas,
        width: recordingCanvas.width,
        height: recordingCanvas.height,
        drawFrame,
        cleanup: () => {
          if (!sharedCapture) capture.cleanup();
        },
      };
  }

  async function chooseH264Config(width, height, fps, bitrate) {
    const codecs = ['avc1.640033', 'avc1.4D4033', 'avc1.420033', 'avc1.42E01E'];
    const accelerationModes = ['prefer-hardware', 'no-preference', 'prefer-software'];
    for (const hardwareAcceleration of accelerationModes) {
      for (const codec of codecs) {
        const config = {
          codec,
          width,
          height,
          bitrate,
          framerate: fps,
          hardwareAcceleration,
          latencyMode: 'quality',
          avc: { format: 'avc' },
        };
        const support = await VideoEncoder.isConfigSupported(config);
        if (support.supported) return support.config;
      }
    }
    throw new Error('当前 Chrome 无法创建所需分辨率的 H.264 编码器');
  }

  // QuickTime PNG codec: lossless RGBA samples, one sample per planned frame.
  // No real-time recorder or wall-clock timestamp is involved in this path.
  function buildAlphaMov(samples, width, height, fps) {
    if (!samples.length || width > 65535 || height > 65535) throw new Error('MOV 尺寸或帧数无效');
    const bytes = (...parts) => {
      const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
      let offset = 0;
      for (const part of parts) { out.set(part, offset); offset += part.length; }
      return out;
    };
    const u32 = (...values) => {
      const out = new Uint8Array(values.length * 4);
      const view = new DataView(out.buffer);
      values.forEach((value, index) => view.setUint32(index * 4, value));
      return out;
    };
    const u16 = value => new Uint8Array([value >>> 8 & 255, value & 255]);
    const str = value => Uint8Array.from(value, char => char.charCodeAt(0));
    const zero = length => new Uint8Array(length);
    const atom = (type, ...parts) => {
      const data = bytes(...parts);
      return bytes(u32(data.length + 8), str(type), data);
    };
    const full = (type, ...parts) => atom(type, u32(0), ...parts);
    const matrix = u32(65536, 0, 0, 0, 65536, 0, 0, 0, 0x40000000);
    const count = samples.length;
    const total = samples.reduce((n, sample) => n + sample.size, 0);
    if (total > 1024 * 1024 * 1024) throw new Error('透明 MOV 超过 1GB 安全上限，请减少圈数或时长后重试');
    const ftyp = atom('ftyp', str('qt  '), u32(0), str('qt  '));
    const mvhd = full('mvhd', u32(0, 0, fps, count, 65536), u16(256), zero(10), matrix, zero(24), u32(2));
    const tkhd = atom('tkhd', u32(3, 0, 0, 1, 0, count), zero(8), zero(8), matrix, u32(width * 65536, height * 65536));
    const mdhd = full('mdhd', u32(0, 0, fps, count), u16(0), u16(0));
    const hdlr = full('hdlr', u32(0), str('vide'), zero(12), str('Video\0'));
    const compressor = zero(32);
    compressor.set(bytes(new Uint8Array([3]), str('PNG')));
    const entry = atom('png ', zero(6), u16(1), zero(16), u16(width), u16(height),
      u32(0x480000, 0x480000, 0), u16(1), compressor, u16(32), u16(65535));
    const stsd = full('stsd', u32(1), entry);
    const stts = full('stts', u32(1, count, 1));
    const stsc = full('stsc', u32(1, 1, count, 1));
    const sizes = new Uint8Array(count * 4);
    const sizesView = new DataView(sizes.buffer);
    samples.forEach((sample, index) => sizesView.setUint32(index * 4, sample.size));
    const stsz = full('stsz', u32(0, count), sizes);
    const stco = full('stco', u32(1, ftyp.length + 8));
    const stbl = atom('stbl', stsd, stts, stsc, stsz, stco);
    const dinf = atom('dinf', full('dref', u32(1), atom('url ', u32(1))));
    const minf = atom('minf', atom('vmhd', u32(1), zero(8)), dinf, stbl);
    const moov = atom('moov', mvhd, atom('trak', tkhd, atom('mdia', mdhd, hdlr, minf)));
    return new Blob([ftyp, u32(total + 8), str('mdat'), ...samples, moov], { type: 'video/quicktime' });
  }

  async function prepareRecording(canvas, options = {}) {
    if (!settings.recordEnabled && !options.forceRecord) return null;
    requireCanvasRecording();
    if (settings.transparentOutput) {
      return {
        ...createCanvasFrameSource(canvas, false),
        format: 'mov', samples: [], sampleBytes: 0, fps: Math.round(settings.recordingFps),
        started: false, finalized: false, frameIndex: 0,
        outputFilename: options.outputFilename || null, outputTarget: options.outputTarget || null,
      };
    }
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
      throw new Error('当前浏览器没有 WebCodecs 固定帧编码能力');
    }
    if (typeof Mp4Muxer === 'undefined') {
      throw new Error('MP4 封装组件加载失败，请检查网络后刷新页面');
    }

    const fps = Math.round(settings.recordingFps);
    const source = settings.recordingScope === 'tab'
      ? await createTabFrameSource(fps, canvas, options.tabCapture || null)
      : createCanvasFrameSource(canvas);

    const bitrate = settings.videoBitrateMbps > 0
      ? Math.round(settings.videoBitrateMbps * 1_000_000)
      : autoBitrate(source.width, source.height, fps);
    const encoderConfig = await chooseH264Config(source.width, source.height, fps, bitrate);
    const target = new Mp4Muxer.ArrayBufferTarget();
    const muxer = new Mp4Muxer.Muxer({
      target,
      video: {
        codec: 'avc',
        width: source.width,
        height: source.height,
        frameRate: fps,
      },
      fastStart: 'in-memory',
    });
    const session = {
      ...source,
      target,
      muxer,
      bitrate,
      fps,
      started: false,
      finalized: false,
      frameIndex: 0,
      encoderError: null,
      outputFilename: options.outputFilename || null,
      outputTarget: options.outputTarget || null,
    };
    session.encoder = new VideoEncoder({
      output: (chunk, metadata) => muxer.addVideoChunk(chunk, metadata),
      error: (error) => {
        session.encoderError = error;
        console.error('[Tripo Rotation] H.264 编码失败', error);
      },
    });
    session.encoder.configure(encoderConfig);
    return session;
  }

  function startRecorder(session) {
    if (!session || session.started) return;
    session.started = true;
  }

  async function captureDeterministicFrame(session, alreadyCopied = false) {
    if (!session?.started || session.finalized) return;
    if (!alreadyCopied) session.drawFrame();
    if (session.format === 'mov') {
      const sample = await new Promise((resolve, reject) => session.canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('透明 PNG 帧编码失败')), 'image/png'));
      session.sampleBytes += sample.size;
      if (session.sampleBytes > 1024 * 1024 * 1024) throw new Error('透明 MOV 超过 1GB 安全上限，请减少圈数或时长');
      session.samples.push(sample);
      session.frameIndex += 1;
      return;
    }
    const timestamp = Math.round(session.frameIndex * 1_000_000 / session.fps);
    const nextTimestamp = Math.round((session.frameIndex + 1) * 1_000_000 / session.fps);
    const frame = new VideoFrame(session.canvas, {
      timestamp,
      duration: nextTimestamp - timestamp,
      alpha: 'discard',
    });
    try {
      session.encoder.encode(frame, {
        keyFrame: session.frameIndex % Math.max(1, Math.round(session.fps)) === 0,
      });
    } finally { frame.close(); }
    session.frameIndex += 1;
    if (session.encoder.encodeQueueSize > 8) await session.encoder.flush();
    if (session.encoderError) throw session.encoderError;
  }

  async function finalizeRecording(session, mode, cancelled = false) {
    if (!session || session.finalized) return null;
    session.finalized = true;
    try {
      if (!session.started) return null;
      let blob;
      if (session.format === 'mov') {
        blob = buildAlphaMov(session.samples, session.width, session.height, session.fps);
        session.samples.length = 0;
      } else {
        await session.encoder.flush();
        if (session.encoderError) throw session.encoderError;
        session.encoder.close();
        session.muxer.finalize();
        blob = new Blob([session.target.buffer], { type: 'video/mp4' });
      }
      if (blob.size < 1024) throw new Error('录制文件为空');
      const requestedFilename = session.outputFilename;
      const finalFilename = cancelled && requestedFilename
        ? withStoppedSuffix(requestedFilename)
        : requestedFilename;
      const filename = finalFilename
        ? await saveBlob(blob, finalFilename, session.outputTarget)
        : downloadVideo(blob, session, mode, cancelled);
      setStatus(`视频已保存：${filename}`, 'ready');
      return filename;
    } catch (error) {
      setStatus(`视频保存失败：${error.message}`, 'error');
      console.error('[Tripo Rotation] MP4 保存失败', error);
      return null;
    } finally {
      if (session.encoder && session.encoder.state !== 'closed') session.encoder.close();
      if (session.samples) session.samples.length = 0;
      session.cleanup();
    }
  }

  function pointerEvent(type, x, y, buttons, movementX = 0) {
    return new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: POINTER_ID,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      movementX,
      movementY: 0,
      pressure: buttons ? 0.5 : 0,
      width: 1,
      height: 1,
    });
  }

  function dispatchPointer(target, type, x, y, buttons, movementX = 0) {
    target.dispatchEvent(pointerEvent(type, x, y, buttons, movementX));
  }

  function sleep(ms, run) {
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        if (run) run.timers.delete(timer);
        resolve();
      }, ms);
      if (run) run.timers.set(timer, resolve);
    });
  }

  // 甩转加速：速度使用 x^3，前段蓄力，后段迅速冲向峰值。
  function accelerationArea(x) {
    return 0.25 * x * x * x * x;
  }

  // 快速制动：速度使用 (1-x)^3，尽快脱离高速并自然收零。
  function decelerationArea(x) {
    return 0.25 * (1 - Math.pow(1 - x, 4));
  }

  function transitionProgress(elapsed, acceleration, cruise, deceleration) {
    const totalArea = acceleration * 0.25 + cruise + deceleration * 0.25;
    if (elapsed <= acceleration) {
      const x = acceleration > 0 ? elapsed / acceleration : 1;
      return acceleration * accelerationArea(x) / totalArea;
    }

    if (elapsed <= acceleration + cruise) {
      return (acceleration * 0.25 + elapsed - acceleration) / totalArea;
    }

    const decelElapsed = Math.min(deceleration, elapsed - acceleration - cruise);
    const x = deceleration > 0 ? decelElapsed / deceleration : 1;
    return (acceleration * 0.25 + cruise +
      deceleration * decelerationArea(x)) / totalArea;
  }

  function sanitizeSettingsFromUI() {
    settings.direction = Number(ui.direction.value) === 1 ? 1 : -1;
    settings.pixelsPerTurnRatio = clamp(ui.ratio.value, 0.2, 3, 1);
    settings.uniformTurns = Math.round(clamp(ui.uniformTurns.value, 1, 20, 1));
    settings.uniformDuration = clamp(ui.uniformDuration.value, 0.5, 30, 3);
    settings.transitionTurns = clamp(ui.transitionTurns.value, 0.25, 20, 4);
    settings.accelerationDuration = clamp(ui.acceleration.value, 0.05, 20, 0.65);
    settings.cruiseDuration = clamp(ui.cruise.value, 0, 60, 0.7);
    settings.decelerationDuration = clamp(ui.deceleration.value, 0.05, 20, 0.3);
    settings.countdown = clamp(ui.countdown.value, 0, 10, 2);
    settings.settleDuration = clamp(ui.settle.value, 0, 5, 0.25);
    settings.autoHide = ui.autoHide.checked;
    settings.recordEnabled = ui.recordEnabled.checked;
    settings.recordingScope = ui.recordingScope.value === 'tab' ? 'tab' : 'canvas';
    settings.recordingFps = clamp(ui.recordingFps.value, 15, 120, 60);
    settings.videoBitrateMbps = clamp(ui.videoBitrate.value, 0, 200, 0);
    settings.showAxisInOutput = ui.showAxisInOutput.checked;
    settings.transparentOutput = ui.transparentOutput.checked;
    settings.studioLighting = ui.studioLighting.checked;
    settings.lightingEnvironment = clamp(ui.lightingEnvironment.value, 0, 3, 1.4);
    settings.lightingDirect = clamp(ui.lightingDirect.value, 0, 3, 1.2);
    settings.lightingExposure = clamp(ui.lightingExposure.value, 0.5, 2, 1.15);
    settings.brightSolid = ui.brightSolid.checked;
    settings.solidLift = clamp(ui.solidLift.value, 0, 1, 0.5);
    saveSettings();
    syncUI();
    applyLightingPreset();
    applySolidLook();
  }

  function syncUI() {
    ui.direction.value = String(settings.direction);
    ui.ratio.value = String(settings.pixelsPerTurnRatio);
    ui.uniformTurns.value = String(settings.uniformTurns);
    ui.uniformDuration.value = String(settings.uniformDuration);
    ui.transitionTurns.value = String(settings.transitionTurns);
    ui.acceleration.value = String(settings.accelerationDuration);
    ui.cruise.value = String(settings.cruiseDuration);
    ui.deceleration.value = String(settings.decelerationDuration);
    ui.countdown.value = String(settings.countdown);
    ui.settle.value = String(settings.settleDuration);
    ui.autoHide.checked = settings.autoHide;
    ui.recordEnabled.checked = settings.recordEnabled;
    ui.recordingScope.value = settings.recordingScope;
    ui.recordingFps.value = String(settings.recordingFps);
    ui.videoBitrate.value = String(settings.videoBitrateMbps);
    ui.showAxisInOutput.checked = settings.showAxisInOutput;
    ui.transparentOutput.checked = settings.transparentOutput;
    ui.studioLighting.checked = settings.studioLighting;
    ui.lightingEnvironment.value = String(settings.lightingEnvironment);
    ui.lightingDirect.value = String(settings.lightingDirect);
    ui.lightingExposure.value = String(settings.lightingExposure);
    ui.brightSolid.checked = settings.brightSolid;
    ui.solidLift.value = String(settings.solidLift);
    ui.solidLift.disabled = !settings.brightSolid;
    for (const input of [ui.lightingEnvironment, ui.lightingDirect, ui.lightingExposure]) {
      input.disabled = !settings.studioLighting;
    }
    ui.videoBitrate.disabled = settings.transparentOutput;
    ui.videoBitrate.title = settings.transparentOutput ? '透明 MOV 为无损 PNG 帧，不使用 MP4 码率设置' : '';
  }

  async function takeScreenshot(options = {}) {
    if (activeRun) {
      setStatus('请先停止当前旋转，再进行截图', 'warning');
      return;
    }
    sanitizeSettingsFromUI();
    const canvas = findViewerCanvas();
    if (!canvas) {
      setStatus('没有找到已加载的模型 Canvas', 'error');
      return;
    }

    let source = null;
    let frameLock = null;
    const restorePanel = panelVisible;
    try {
      setStatus('正在准备高清截图…', 'running');
      if (settings.transparentOutput && settings.recordingScope === 'tab') {
        throw new Error('透明导出仅支持“仅模型”范围，标签页录屏不保留 Alpha');
      }
      if (settings.recordingScope === 'tab') {
        applySolidLook(true);
        showPanel(false);
        await nextRenderedFrame();
        source = await createTabFrameSource(
          settings.recordingFps,
          canvas,
          options.tabCapture || null
        );
        await nextRenderedFrame();
        source.drawFrame();
      } else {
        applySolidLook(true);
        frameLock = createFrameLock(canvas, options.batchState?.view);
        source = createCanvasFrameSource(canvas, false);
        await frameLock.capture(0, (signature) => {
          verifyBatchFrame(options.batchState, 'screenshot', 0, signature);
          source.drawFrame();
        });
        frameLock.release();
      }
      const blob = await new Promise((resolve, reject) => {
        source.canvas.toBlob(
          (value) => value ? resolve(value) : reject(new Error('PNG 编码失败')),
          'image/png',
          1
        );
      });
      const filename = options.outputFilename
        ? await saveBlob(blob, options.outputFilename, options.outputTarget)
        : downloadScreenshot(blob, source, settings.recordingScope);
      setStatus(`截图已保存：${filename}`, 'ready');
      return filename;
    } catch (error) {
      setStatus(`截图失败：${error.message}`, 'error');
      console.error('[Tripo Rotation] 截图失败', error);
      return null;
    } finally {
      frameLock?.release();
      source?.cleanup?.();
      if (restorePanel) showPanel(true);
    }
  }

  function syncProjectNameField() {
    if (!ui?.projectName || shadow.activeElement === ui.projectName) return;
    ui.projectName.value = getProjectName();
    ui.projectName.placeholder = `工程 ID：${currentProjectId().slice(0, 8)}…`;
  }

  function requestProjectName(force = false) {
    const remembered = getProjectName();
    if (remembered && !force) return Promise.resolve(remembered);
    if (pendingProjectName) return pendingProjectName.promise;

    let resolvePromise;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    pendingProjectName = { promise, resolve: resolvePromise };
    ui.projectNameModal.hidden = false;
    ui.projectNameInput.value = remembered;
    window.setTimeout(() => {
      ui.projectNameInput.focus();
      ui.projectNameInput.select();
    }, 0);
    return promise;
  }

  function finishProjectName(value, skip = false) {
    if (!pendingProjectName) return;
    const pending = pendingProjectName;
    pendingProjectName = null;
    ui.projectNameModal.hidden = true;
    const name = String(value || '').trim();
    if (name && !skip) saveProjectName(name);
    pending.resolve(skip ? `工程-${currentProjectId()}` : name || null);
  }

  function requestBatchCaptureStart() {
    if (pendingBatchStart) return pendingBatchStart.promise;
    let resolvePromise;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    pendingBatchStart = { promise, resolve: resolvePromise };
    ui.batchStartModal.hidden = false;
    return promise;
  }

  function finishBatchCaptureStart(confirmed) {
    if (!pendingBatchStart) return;
    const pending = pendingBatchStart;
    pendingBatchStart = null;
    ui.batchStartModal.hidden = true;
    pending.resolve(Boolean(confirmed));
  }

  function findMaterialButton(materialId) {
    const material = MATERIALS.find((item) => item.id === materialId);
    if (!material) return null;
    return findButtonWithIcon(material.icon);
  }

  async function switchMaterial(material) {
    const button = findMaterialButton(material.id);
    if (!button) throw new Error(`没有找到“${material.label}”显示按钮`);
    if (material.id !== 'solid') restoreSolidLook();
    if (button.getAttribute('aria-pressed') !== 'true' && button.dataset.state !== 'on') {
      button.click();
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(100);
        if (button.getAttribute('aria-pressed') === 'true' || button.dataset.state === 'on') break;
        if (attempt === 49) throw new Error(`切换到“${material.label}”超时`);
      }
    }
    await nextRenderedFrame();
    await nextRenderedFrame();
    await sleep(250);
    applySolidLook(true);
  }

  async function switchWireframe(enabled) {
    const button = findWireframeButton();
    if (!button || button.disabled) {
      if (enabled) throw new Error('当前项目不支持线框模式');
      return;
    }
    if (toggleIsOn(button) !== enabled) {
      button.click();
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await sleep(100);
        if (toggleIsOn(button) === enabled) break;
        if (attempt === 49) throw new Error(`${enabled ? '开启' : '关闭'}线框模式超时`);
      }
    }
    await nextRenderedFrame();
    await nextRenderedFrame();
    await sleep(250);
  }

  async function runExportAction(action) {
    if (exportBusy || batchRunning || activeRun || pendingSave) {
      if (pendingSave) showSaveRecovery(pendingSave);
      return;
    }
    exportBusy = true;
    if (ui.batchMenu) {
      ui.batchMenu.hidden = true;
      ui.batchToggle.setAttribute('aria-expanded', 'false');
    }
    try {
      await action();
    } catch (error) {
      setStatus(`导出失败：${error.message}`, 'error');
      console.error('[Tripo Rotation] 导出失败', error);
    } finally {
      exportBusy = false;
      if (ui.projectsPage && !ui.projectsPage.hidden) renderProjectLibrary();
    }
  }

  async function handleRotationClick(mode) {
    sanitizeSettingsFromUI();
    if (!settings.recordEnabled) {
      await startRotation(mode);
      return;
    }
    if (settings.recordingScope === 'tab') {
      setStatus('整标签页目前仅支持截图；视频请切换为“仅模型画面”', 'warning');
      return;
    }
    const projectName = await requestProjectName();
    if (!projectName) return;
    const material = currentMaterial();
    const filename = buildOutputFilename(mode, projectName, material.label, toggleIsOn(findWireframeButton()));
    try {
      const target = await chooseSingleFile(filename, settings.transparentOutput ? 'video/quicktime' : 'video/mp4');
      await startRotation(mode, { outputFilename: filename, outputTarget: target });
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setStatus(`无法开始导出：${error.message}`, 'error');
        console.error('[Tripo Rotation] 单项视频导出失败', error);
      } else {
        setStatus('已取消保存', 'warning');
      }
    }
  }

  async function handleScreenshotClick() {
    sanitizeSettingsFromUI();
    const projectName = await requestProjectName();
    if (!projectName) return;
    const material = currentMaterial();
    const filename = buildOutputFilename('screenshot', projectName, material.label, toggleIsOn(findWireframeButton()));
    try {
      const target = await chooseSingleFile(filename, 'image/png');
      await takeScreenshot({ outputFilename: filename, outputTarget: target });
    } catch (error) {
      if (error?.name !== 'AbortError') {
        setStatus(`无法开始截图：${error.message}`, 'error');
        console.error('[Tripo Rotation] 单项截图失败', error);
      } else {
        setStatus('已取消保存', 'warning');
      }
    }
  }

  async function exportAll() {
    if (batchRunning || activeRun) {
      setStatus('已有导出任务正在运行', 'warning');
      return;
    }
    sanitizeSettingsFromUI();
    // Snapshot the selection once; changes must never reshape an in-flight batch.
    const jobs = plannedExportItems();
    if (!jobs.length) {
      setStatus('请先勾选至少一个导出项目', 'warning');
      return;
    }
    if (settings.recordingScope === 'tab' && jobs.some(job => job.kind !== 'screenshot')) {
      setStatus('整标签页批量导出仅支持截图；请取消勾选视频，或切换为“仅模型画面”', 'warning');
      return;
    }
    const projectName = await requestProjectName();
    if (!projectName) return;

    let outputTarget = { kind: 'download' };
    let tabCapture = null;
    let batchState = null;
    const originalMaterial = currentMaterial();
    const originalWireframe = toggleIsOn(findWireframeButton());
    const restorePanel = panelVisible;
    try {
      const canvas = findViewerCanvas();
      if (!canvas) throw new Error('请先打开一个已加载的模型');
      batchState = { view: snapshotView(findRenderContext(canvas)), signatures: new Map(),
        plans: { uniform: makeFramePlan('uniform', settings), transition: makeFramePlan('transition', settings) } };
      if (typeof window.showDirectoryPicker === 'function') {
        outputTarget = { kind: 'directory', handle: await window.showDirectoryPicker({ mode: 'readwrite' }) };
      }
      if (settings.recordingScope === 'tab') {
        const confirmed = await requestBatchCaptureStart();
        if (!confirmed) return;
        tabCapture = await createTabCapture(settings.recordingFps);
      }

      batchRunning = true;
      showPanel(false);
      let completed = 0;
      const total = jobs.length;
      const progress = (message) => setStatus(`全导出 ${completed}/${total} · ${message}`, 'running');

      for (const { kind, material, wireframe } of jobs) {
        const label = EXPORT_KINDS.find(item => item.id === kind).label;
        progress(`正在导出${material.label}${wireframe ? '线框' : ''}${label}…`);
        await switchMaterial(material);
        await switchWireframe(wireframe);
        const filename = buildOutputFilename(kind, projectName, material.label, wireframe);
        const options = { forceRecord: true, outputFilename: filename, outputTarget,
          tabCapture, suppressAutoShow: true, restoreAfter: true, batchState };
        const saved = kind === 'screenshot' ? await takeScreenshot(options) : await startRotation(kind, options);
        if (!saved) throw new Error(`${material.label}${wireframe ? '线框' : ''}${label}导出失败`);
        completed += 1;
      }

      setStatus(`一键导出完成 · 共保存 ${total} 个文件`, 'ready', true);
    } catch (error) {
      if (error?.name === 'AbortError') {
        setStatus('已取消一键全导出', 'warning');
      } else {
        setStatus(`一键全导出失败：${error.message}`, 'error');
        console.error('[Tripo Rotation] 一键全导出失败', error);
      }
    } finally {
      batchRunning = false;
      tabCapture?.cleanup?.();
      if (originalMaterial.id !== 'current') {
        try { await switchMaterial(originalMaterial); } catch (error) {
          console.warn('[Tripo Rotation] 恢复原显示模式失败', error);
        }
      }
      try { await switchWireframe(originalWireframe); } catch (error) {
        console.warn('[Tripo Rotation] 恢复原线框状态失败', error);
      }
      if (batchState) {
        try { applyView(findRenderContext(findViewerCanvas()), batchState.view); }
        catch (error) { console.warn('[Tripo Rotation] 恢复批量起始视角失败', error); }
      }
      if (restorePanel) showPanel(true);
    }
  }

  function setStatus(message, tone = 'normal', persistent = false) {
    statusIsSticky = persistent || tone === 'error';
    ui.status.textContent = message;
    ui.status.dataset.tone = tone;
    console.info(`[Tripo Rotation] ${message}`);
  }

  function refreshCanvasStatus() {
    syncProjectNameField();
    if (ui.exportAll && ui.batchMenu) syncBatchSelection();
    if (activeRun || batchRunning || exportBusy || pendingSave) return;
    if (settings.studioLighting) applyLightingPreset();
    const solidApplied = applySolidLook();
    if (statusIsSticky) return;
    const canvas = findViewerCanvas();
    if (!canvas) {
      setStatus('等待模型预览器加载…', 'warning');
      return;
    }
    if (settings.brightSolid && currentMaterial().id === 'solid' && !solidApplied) {
      setStatus('当前白膜材质无法安全提亮，已保留原站画面', 'warning');
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const controls = canvas.dataset.cameraControlsVersion || '未知';
    const engine = canvas.dataset.engine || 'Canvas';
    const recording = settings.recordEnabled
      ? ` · ${settings.transparentOutput ? '透明 MOV' : 'MP4'} ${settings.recordingFps}fps`
      : ' · 不录制';
    setStatus(`已连接 · ${engine} · ${Math.round(rect.width)}×${Math.round(rect.height)}${recording}`, 'ready');
  }

  function showPanel(visible, manual = false) {
    if (manual) visibilityRevision += 1;
    panelVisible = visible;
    ui.panel.hidden = !visible;
  }

  function scheduleAutoShow() {
    if (!settings.autoHide) return;
    const expectedRevision = visibilityRevision;
    window.setTimeout(() => {
      if (!activeRun && !batchRunning && !pendingSave && visibilityRevision === expectedRevision) {
        showPanel(true);
        refreshCanvasStatus();
      }
    }, 1000);
  }

  function stopRotation(reason = '已手动停止') {
    // 保存恢复窗口中的 Blob 必须留在原队列里，停止/切后台不能把它丢掉。
    if (pendingSave) {
      showSaveRecovery(pendingSave);
      return;
    }
    const run = activeRun;
    if (run?.recording?.finalized) return;
    if (!run) {
      setStatus(reason, 'warning');
      return;
    }

    run.cancelled = true;
    if (run.strictFrames) {
      run.frameLock?.release();
      for (const [timer, resolve] of run.timers) { clearTimeout(timer); resolve(); }
      run.timers.clear();
      setStatus(reason, 'warning');
      return; // The serial owner performs encoder/lock cleanup; never finalize twice.
    }
    if (run.frame) cancelAnimationFrame(run.frame);
    for (const [timer, resolve] of run.timers) {
      clearTimeout(timer);
      resolve();
    }
    run.timers.clear();

    if (run.pointerDown) {
      dispatchPointer(document, 'pointerup', run.lastX, run.y, 0, 0);
      run.pointerDown = false;
    }

    activeRun = null;
    setStatus(reason, 'warning');
    void finalizeRecording(run.recording, run.mode, true);
    scheduleAutoShow();
  }

  async function countdown(run) {
    const seconds = Math.ceil(settings.countdown);
    if (seconds <= 0) return true;

    for (let remaining = seconds; remaining > 0; remaining -= 1) {
      if (run.cancelled || activeRun !== run) return false;
      setStatus(`${remaining} 秒后开始…按 Esc 取消`, 'countdown');
      if (settings.autoHide && remaining <= 1) showPanel(false);
      await sleep(1000, run);
    }
    return !run.cancelled && activeRun === run;
  }

  function nextRenderedFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  function makeFramePlan(mode, config) {
    const fps = Math.round(config.recordingFps);
    const duration = mode === 'uniform' ? config.uniformDuration * config.uniformTurns
      : config.accelerationDuration + config.cruiseDuration + config.decelerationDuration;
    const count = Math.max(1, Math.round(duration * fps));
    const hold = Math.max(0, Math.round(config.settleDuration * fps));
    const turns = mode === 'uniform' ? config.uniformTurns : config.transitionTurns;
    const endAngle = -config.direction * 2 * Math.PI * turns;
    const angles = [];
    for (let index = 0; index < count; index += 1) {
      const elapsed = duration * index / count;
      const progress = mode === 'uniform' ? index / count : transitionProgress(elapsed,
        config.accelerationDuration, config.cruiseDuration, config.decelerationDuration);
      angles.push(endAngle * progress);
    }
    // Optional stop hold consists of identical, exact endpoint poses, not damping.
    for (let index = 0; index < hold; index += 1) angles.push(endAngle);
    return Object.freeze({ fps, angles: Object.freeze(angles), endAngle, movingFrames: count });
  }

  function verifyBatchFrame(batchState, mode, index, signature) {
    if (!batchState) return;
    const key = `${mode}:${index}`;
    const expected = batchState.signatures.get(key);
    if (expected) assertSignature(signature, expected, `${mode} 第 ${index + 1} 帧跨材质视角`);
    else batchState.signatures.set(key, signature.slice());
  }

  async function startStrictRotation(mode, canvas, options) {
    requireCanvasRecording();
    applySolidLook(true);
    const config = { ...settings };
    const plan = options.batchState?.plans[mode] || makeFramePlan(mode, config);
    const run = { mode, canvas, strictFrames: true, cancelled: false,
      frame: 0, timers: new Map(), recording: null, frameLock: null };
    activeRun = run;
    let success = false;
    try {
      run.frameLock = createFrameLock(canvas, options.batchState?.view);
      run.recording = await prepareRecording(canvas, options);
      if (run.recording.fps !== plan.fps) throw new Error('批量导出期间帧率设置发生变化');
      if (!await countdown(run)) return null;
      if (config.autoHide) showPanel(false);
      startRecorder(run.recording);
      for (let index = 0; index < plan.angles.length; index += 1) {
        if (run.cancelled || activeRun !== run) throw new Error('用户已停止录制');
        await run.frameLock.capture(plan.angles[index], (signature) => {
          verifyBatchFrame(options.batchState, mode, index, signature);
          run.recording.drawFrame();
        });
        if (run.cancelled) throw new Error('用户已停止录制');
        await captureDeterministicFrame(run.recording, true);
        if (index % 30 === 0) setStatus(`严格逐帧 ${index + 1}/${plan.angles.length} · ${plan.fps}fps`, 'running');
      }
      if (run.recording.frameIndex !== plan.angles.length) throw new Error('编码输入帧数与轨迹帧数不一致');
      // Verify and show the endpoint without encoding an extra duplicate frame.
      await run.frameLock.capture(options.restoreAfter ? 0 : plan.endAngle, () => {});
      run.frameLock.release();
      setStatus('帧数与视角检查通过，正在封装视频…', 'running');
      const filename = await finalizeRecording(run.recording, mode);
      success = Boolean(filename);
      if (success) setStatus(`严格逐帧完成 · ${plan.angles.length} 帧 · ${plan.fps}fps`, 'ready', true);
      return filename;
    } catch (error) {
      setStatus(`逐帧导出已停止：${error.message}（未保存不完整视频）`, 'error');
      console.error('[Tripo Rotation] 严格逐帧导出失败', error);
      return null;
    } finally {
      if (run.frameLock) {
        if (!success) {
          try { run.frameLock.restore(); } catch (error) { console.warn('[Tripo Rotation] 恢复视角失败', error); }
        }
        run.frameLock.release();
      }
      if (run.recording && !run.recording.finalized) {
        if (run.recording.encoder && run.recording.encoder.state !== 'closed') run.recording.encoder.close();
        if (run.recording.samples) run.recording.samples.length = 0;
        run.recording.cleanup();
      }
      if (activeRun === run) activeRun = null;
      if (!options.suppressAutoShow) {
        if (success) scheduleAutoShow();
        else showPanel(true);
      }
    }
  }

  async function animateDrag(run, durationMs, totalDistance, progressAt) {
    if (run.recording) throw new Error('禁止通过模拟拖拽录制视频');

    return new Promise((resolve) => {
      const startTime = performance.now();
      let previousDistance = 0;

      const step = (now) => {
        if (run.cancelled || activeRun !== run || !run.canvas.isConnected) {
          resolve(false);
          return;
        }

        const elapsedMs = Math.min(durationMs, now - startTime);
        const progress = Math.min(1, Math.max(0, progressAt(elapsedMs / 1000)));
        const distance = totalDistance * progress;
        const delta = distance - previousDistance;
        run.lastX = run.startX + settings.direction * distance;

        dispatchPointer(document, 'pointermove', run.lastX, run.y, 1,
          settings.direction * delta);
        previousDistance = distance;

        if (elapsedMs >= durationMs) {
          resolve(true);
          return;
        }
        run.frame = requestAnimationFrame(step);
      };

      run.frame = requestAnimationFrame(step);
    });
  }

  async function captureSettlingFrames(run) {
    if (run.recording) throw new Error('禁止通过缓动等待补齐视频帧');
    await sleep(settings.settleDuration * 1000, run);
  }

  async function restoreViewAfterRotation(canvas, totalDistance) {
    const rect = canvas.getBoundingClientRect();
    const startX = rect.left + rect.width * 0.5;
    const y = rect.top + rect.height * 0.5;
    const steps = 18;
    let previous = 0;
    dispatchPointer(canvas, 'pointerdown', startX, y, 1, 0);
    try {
      for (let step = 1; step <= steps; step += 1) {
        const distance = totalDistance * step / steps;
        const delta = distance - previous;
        const x = startX - settings.direction * distance;
        dispatchPointer(document, 'pointermove', x, y, 1, -settings.direction * delta);
        previous = distance;
        await nextRenderedFrame();
      }
    } finally {
      dispatchPointer(document, 'pointerup', startX - settings.direction * totalDistance, y, 0, 0);
    }
  }

  async function startRotation(mode, options = {}) {
    if (activeRun) {
      setStatus('旋转正在运行；按 Esc 可停止', 'warning');
      return;
    }

    sanitizeSettingsFromUI();
    const canvas = findViewerCanvas();
    if (!canvas) {
      setStatus('没有找到已加载的模型 Canvas', 'error');
      showPanel(true);
      return;
    }

    applySolidLook(true);

    if (settings.recordEnabled || options.forceRecord) {
      return startStrictRotation(mode, canvas, options);
    }

    const rect = canvas.getBoundingClientRect();
    const pixelsPerTurn = rect.height * settings.pixelsPerTurnRatio;
    const run = {
      mode,
      canvas,
      cancelled: false,
      pointerDown: false,
      frame: 0,
      timers: new Map(),
      startX: rect.left + rect.width * 0.5,
      lastX: rect.left + rect.width * 0.5,
      y: rect.top + rect.height * 0.5,
      recording: null,
    };
    activeRun = run;

    try {
      run.recording = await prepareRecording(canvas, options);
    } catch (error) {
      activeRun = null;
      if (!options.suppressAutoShow) showPanel(true);
      setStatus(`无法开始 MP4 录制：${error.message}`, 'error');
      console.error('[Tripo Rotation] 无法开始录制', error);
      return;
    }

    const ready = await countdown(run);
    if (!ready) return;
    if (settings.autoHide && settings.countdown <= 0) showPanel(false);

    startRecorder(run.recording);
    dispatchPointer(canvas, 'pointerdown', run.startX, run.y, 1, 0);
    run.pointerDown = true;

    try {
      let completed = false;
      let totalDistance = 0;
      if (mode === 'uniform') {
      setStatus(`匀速旋转中（${settings.uniformTurns} 圈）…`, 'running');
      const durationSeconds = settings.uniformDuration * settings.uniformTurns;
      const durationMs = durationSeconds * 1000;
      totalDistance = pixelsPerTurn * settings.uniformTurns;
      completed = await animateDrag(run, durationMs, totalDistance,
        (elapsed) => elapsed / durationSeconds);
      } else {
      setStatus('加速转场旋转中…', 'running');
      const a = settings.accelerationDuration;
      const c = settings.cruiseDuration;
      const d = settings.decelerationDuration;
      const durationMs = (a + c + d) * 1000;
      totalDistance = pixelsPerTurn * settings.transitionTurns;
      completed = await animateDrag(run, durationMs,
        totalDistance,
        (elapsed) => transitionProgress(elapsed, a, c, d));
      }

      if (!completed || activeRun !== run) return;

      dispatchPointer(document, 'pointerup', run.lastX, run.y, 0, 0);
      run.pointerDown = false;
      setStatus('正在编码停止段…', 'running');
      await captureSettlingFrames(run);

      if (options.restoreAfter) {
        setStatus('正在恢复初始视角…', 'running');
        try {
          await restoreViewAfterRotation(canvas, totalDistance);
        } catch (error) {
          console.warn('[Tripo Rotation] 恢复初始视角失败', error);
        }
      }

      if (activeRun === run) {
        setStatus('正在封装固定帧率 MP4…', 'running');
        const filename = await finalizeRecording(run.recording, run.mode, false);
        activeRun = null;
        if (filename || !run.recording) {
          setStatus(filename ? '旋转完成 · MP4 已保存' : '旋转完成', 'ready', true);
        }
        if (!options.suppressAutoShow) scheduleAutoShow();
        return filename;
      }
    } catch (error) {
      if (run.pointerDown) {
        dispatchPointer(document, 'pointerup', run.lastX, run.y, 0, 0);
        run.pointerDown = false;
      }
      run.cancelled = true;
      if (activeRun === run) activeRun = null;
      await finalizeRecording(run.recording, run.mode, true);
      if (!options.suppressAutoShow) showPanel(true);
      setStatus(`固定帧录制失败：${error.message}`, 'error');
      console.error('[Tripo Rotation] 固定帧录制失败', error);
      return null;
    }
  }

  const host = document.createElement('div');
  host.id = SCRIPT_ID;
  host.style.cssText = 'all:initial;position:fixed;right:286px;bottom:18px;z-index:2147483646;pointer-events:none;font-family:Inter,"Microsoft YaHei",sans-serif;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; }
      .panel { width: 304px; color: #f7f7f8; background: rgba(20,21,25,.94); border: 1px solid rgba(255,255,255,.12); border-radius: 14px; box-shadow: 0 16px 45px rgba(0,0,0,.38); backdrop-filter: blur(16px); overflow: hidden; pointer-events: auto; }
      .panel[hidden] { display: none; }
      header { display:flex; align-items:center; justify-content:space-between; padding:12px 13px 10px; border-bottom:1px solid rgba(255,255,255,.08); }
      h2 { margin:0; font-size:14px; font-weight:700; letter-spacing:.2px; }
      .hint { color:#8d9099; font-size:10px; }
      .body { padding:11px 13px 13px; }
      .status { min-height:31px; display:flex; align-items:center; padding:7px 9px; margin-bottom:10px; border-radius:8px; background:rgba(255,255,255,.055); color:#c7c9cf; font-size:10.5px; line-height:1.4; }
      .status[data-tone="ready"] { color:#91e5b1; }
      .status[data-tone="warning"], .status[data-tone="countdown"] { color:#ffd37a; }
      .status[data-tone="error"] { color:#ff8e8e; }
      .status[data-tone="running"] { color:#b7a7ff; }
      .primary { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px; }
      button { appearance:none; border:0; border-radius:9px; color:#fff; background:#34363d; padding:8px; font:600 11px inherit; cursor:pointer; }
      button:hover { filter:brightness(1.14); }
      button:active { transform:translateY(1px); }
      button.run { background:linear-gradient(135deg,#6953ff,#8a63ff); }
      button.capture { grid-column:1 / -1; background:linear-gradient(135deg,#2479d8,#3ba8e8); }
      button.export-all { grid-column:1 / -1; background:linear-gradient(135deg,#168a63,#24b47e); }
      button.stop { background:#6f3438; }
      details { border-top:1px solid rgba(255,255,255,.075); padding-top:8px; }
      summary { cursor:pointer; color:#cfd0d5; font-size:11px; user-select:none; }
      .grid { display:grid; grid-template-columns:1fr 78px; gap:7px 9px; align-items:center; margin-top:9px; }
      label { color:#aeb0b7; font-size:10.5px; }
      input, select { width:100%; min-width:0; color:#f7f7f8; background:#2b2d33; border:1px solid rgba(255,255,255,.1); border-radius:6px; padding:5px 6px; font:11px inherit; outline:none; }
      input:focus, select:focus { border-color:#806bff; }
      .check { display:flex; align-items:center; gap:6px; grid-column:1 / -1; }
      .check input { width:auto; }
      .project-line { display:grid; grid-template-columns:1fr auto; gap:6px; margin-top:9px; }
      .project-line button { padding:5px 9px; }
      .calibrate { display:grid; grid-template-columns:1fr auto auto; gap:6px; margin-top:9px; }
      .calibrate input { min-width:0; }
      .calibrate button { padding:5px 8px; }
      .note { margin:8px 0 0; color:#858892; font-size:9.5px; line-height:1.45; }
      footer { display:flex; justify-content:space-between; margin-top:9px; color:#777b85; font-size:9.5px; }
      kbd { padding:1px 4px; border-radius:4px; background:#303239; color:#bbb; font-family:inherit; }
      .modal-layer { position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(0,0,0,.58); pointer-events:auto; }
      .modal-layer[hidden] { display:none; }
      .modal-card { width:330px; padding:18px; border:1px solid rgba(255,255,255,.14); border-radius:14px; color:#f7f7f8; background:#18191e; box-shadow:0 22px 70px rgba(0,0,0,.55); }
      .modal-card h3 { margin:0 0 7px; font-size:15px; }
      .modal-card p { margin:0 0 12px; color:#aeb0b7; font-size:11px; line-height:1.55; }
      .modal-card input { padding:8px 9px; }
      .modal-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
      .modal-actions button.primary-action { background:#725cff; }
      #saveRecoveryInfo { white-space:pre-wrap; overflow-wrap:anywhere; }
      .modal-actions { flex-wrap:wrap; }
      button:disabled { opacity:.5; cursor:wait; }
      [hidden] { display:none !important; }
      .export-split { grid-column:1 / -1; display:flex; gap:1px; }
      .export-split .export-all { flex:1; border-radius:9px 0 0 9px; }
      .export-split .export-toggle { width:32px; border-radius:0 9px 9px 0; background:#168a63; }
      .batch-menu { grid-column:1 / -1; padding:10px 8px; border:1px solid #3d4546; border-radius:8px; background:#22272b; }
      .batch-menu .note { margin:0 0 8px; }
      .batch-wireframe { display:flex; align-items:center; gap:6px; padding:0 0 8px; border-bottom:1px solid #3d4546; color:#dedee3; font-size:10px; }
      .batch-wireframe input { width:auto; margin:0; }
      .batch-wireframe:has(input:disabled) { color:#858892; }
      .batch-row { display:grid; grid-template-columns:76px repeat(3,1fr); gap:5px; align-items:center; margin-top:8px; font-size:10px; }
      .batch-row label { display:flex; align-items:center; gap:3px; color:#dedee3; font-size:10px; }
      .batch-row input { width:auto; margin:0; }
      .projects-heading { display:flex; align-items:center; gap:10px; margin-bottom:10px; font-size:13px; }
      #projectList { max-height:340px; overflow-y:auto; margin-top:10px; display:grid; gap:7px; }
      .project-entry { display:flex; flex-direction:column; align-items:flex-start; gap:5px; text-align:left; }
      .project-entry span { overflow-wrap:anywhere; }
      .project-entry small { color:#aeb0b7; font-size:10px; font-weight:400; }
    </style>
    <section class="panel">
      <header>
        <h2>Tripo 旋转助手</h2>
        <span class="hint">v${SCRIPT_VERSION} · 明亮白膜</span>
      </header>
      <div class="body">
        <div class="status">正在识别模型预览器…</div>
        <div id="mainPage">
        <div class="primary">
          <button class="run" id="uniform">匀速圈</button>
          <button class="run" id="transition">加速转场</button>
          <button class="capture" id="screenshot">截图当前画面</button>
          <div class="export-split">
            <button class="export-all" id="exportAll">一键导出（9个文件）</button>
            <button class="export-toggle" id="batchToggle" aria-label="选择导出内容" aria-expanded="false" aria-controls="batchMenu">▾</button>
          </div>
          <div class="batch-menu" id="batchMenu" hidden role="group" aria-label="导出内容选择">
            <p class="note">勾选要导出的文件，选择会自动记住。</p>
          </div>
          <button class="stop" id="stop">立即停止</button>
          <button id="hide">隐藏面板</button>
          <button class="capture" id="checkFrameEntry">检查逐帧入口</button>
          <button class="capture" id="openProjects">已命名项目</button>
        </div>
        <details open>
          <summary>录制与截图输出</summary>
          <div class="project-line">
            <input id="projectName" type="text" placeholder="首次导出时命名工程" title="名称按网址中的工程 UUID 分别记忆，允许重名">
            <button id="renameProject">改名</button>
          </div>
          <div class="grid">
            <label class="check"><input id="recordEnabled" type="checkbox">旋转时自动录制并下载视频</label>
            <label for="recordingScope">输出范围</label>
            <select id="recordingScope">
              <option value="canvas">仅模型画面</option>
              <option value="tab">整个当前标签页</option>
            </select>
            <label for="recordingFps">帧率（FPS）</label>
            <input id="recordingFps" type="number" min="15" max="120" step="1" list="fpsOptions">
            <datalist id="fpsOptions"><option value="24"><option value="25"><option value="30"><option value="50"><option value="60"></datalist>
            <label for="videoBitrate">码率（Mbps，0=自动）</label>
            <input id="videoBitrate" type="number" min="0" max="200" step="1">
            <label class="check"><input id="showAxisInOutput" type="checkbox">输出中显示右上角坐标轴</label>
            <label class="check"><input id="transparentOutput" type="checkbox">关闭背景 · 透明 MOV / PNG</label>
            <p class="note">透明输出仅支持“仅模型”。MOV 使用无损 PNG 帧，保留 Alpha；文件较大、导出较慢，单段上限 1GB。背景恢复不影响模型光照。</p>
          </div>
          <p class="note">视频按帧号设置绝对角度，在原生渲染完成时取图。切页不取消：后台有新帧就继续；若浏览器挂起绘制则保留进度，回来续录。请勿刷新或关闭 Tripo。批量三种材质共享起始视角并校验相机矩阵。严格视频暂仅支持“仅模型画面”；整标签页仍可截图。坐标轴默认隐藏，保留背景。</p>
        </details>
        <details>
          <summary>光照效果</summary>
          <div class="grid">
            <label class="check"><input id="studioLighting" type="checkbox">明亮棚拍光照（关闭即恢复原站）</label>
            <label for="lightingEnvironment">环境光倍率</label>
            <input id="lightingEnvironment" type="number" min="0" max="3" step="0.05">
            <label for="lightingDirect">现有灯光倍率</label>
            <input id="lightingDirect" type="number" min="0" max="3" step="0.05">
            <label for="lightingExposure">曝光倍率</label>
            <input id="lightingExposure" type="number" min="0.5" max="2" step="0.05">
          </div>
          <p class="note">棚拍光照保留原有环境、灯光和曝光调节；对白膜 Matcap 可能无效。下面的明亮白膜仅提亮白膜表面中间调，保留黑位、白位及独立线框，贴图与法线不变。</p>
          <div class="grid">
            <label class="check"><input id="brightSolid" type="checkbox">明亮白膜（仅白膜，关闭即恢复）</label>
            <label for="solidLift">白膜提亮强度（0–1）</label>
            <input id="solidLift" type="number" min="0" max="1" step="0.05">
          </div>
        </details>
        <details>
          <summary>参数与校准</summary>
          <div class="grid">
            <label for="direction">旋转方向</label>
            <select id="direction"><option value="-1">顺时针</option><option value="1">逆时针</option></select>
            <label for="uniformTurns">匀速圈数</label>
            <input id="uniformTurns" type="number" min="1" max="20" step="1">
            <label for="uniformDuration">匀速每圈时长（秒）</label>
            <input id="uniformDuration" type="number" min="0.5" max="30" step="0.1">
            <label for="transitionTurns">转场总圈数</label>
            <input id="transitionTurns" type="number" min="0.25" max="20" step="0.25">
            <label for="acceleration">加速时间（秒）</label>
            <input id="acceleration" type="number" min="0.05" max="20" step="0.05">
            <label for="cruise">高速保持（秒）</label>
            <input id="cruise" type="number" min="0" max="60" step="0.1">
            <label for="deceleration">减速时间（秒）</label>
            <input id="deceleration" type="number" min="0.05" max="20" step="0.05">
            <label for="countdown">启动倒计时（秒）</label>
            <input id="countdown" type="number" min="0" max="10" step="1">
            <label for="settle">末尾静止保持（秒）</label>
            <input id="settle" type="number" min="0" max="5" step="0.1">
            <label class="check"><input id="autoHide" type="checkbox">旋转开始时自动隐藏面板</label>
          </div>
          <div class="calibrate">
            <input id="ratio" type="number" min="0.2" max="3" step="0.01" title="一圈拖拽距离 ÷ Canvas 高度">
            <button id="minus" title="一圈距离减少 1%">−1%</button>
            <button id="plus" title="一圈距离增加 1%">+1%</button>
          </div>
        </details>
        <footer>
          <span><kbd>Alt+1</kbd> 匀速圈　<kbd>Alt+2</kbd> 转场　<kbd>Alt+S</kbd> 截图</span>
          <span><kbd>Alt+H</kbd> 面板　<kbd>Esc</kbd> 停止</span>
        </footer>
        </div>
        <div id="projectsPage" hidden>
          <div class="projects-heading"><button id="backProjects">← 返回</button><span>已命名项目</span></div>
          <input id="projectSearch" type="search" placeholder="搜索名称或 ID" aria-label="搜索已命名项目">
          <div id="projectList"></div>
          <p class="note">仅显示在本浏览器中新版命名的项目；点击可切换。导出或保存期间不能切换。</p>
        </div>
      </div>
    </section>
    <div class="modal-layer" id="projectNameModal" hidden>
      <div class="modal-card">
        <h3>命名当前工程</h3>
        <p>命名为可选项，可跳过并使用工程 ID 导出。填写的名称会按工程 UUID 记忆，不同工程允许重名。</p>
        <input id="projectNameInput" type="text" maxlength="80" placeholder="例如：风车">
        <div class="modal-actions">
          <button id="projectNameCancel">取消</button>
          <button id="projectNameSkip">跳过命名</button>
          <button class="primary-action" id="projectNameConfirm">确认并继续</button>
        </div>
      </div>
    </div>
    <div class="modal-layer" id="batchStartModal" hidden>
      <div class="modal-card">
        <h3>文件夹已选择</h3>
        <p>由于输出范围是“整个当前标签页”，下一步 Chrome 会要求选择共享来源。请点击开始，然后选择“当前标签页”。本次批量中的所有文件只需选择一次。</p>
        <div class="modal-actions">
          <button id="batchStartCancel">取消</button>
          <button class="primary-action" id="batchStartConfirm">开始全导出</button>
        </div>
      </div>
    </div>
    <div class="modal-layer" id="saveRecoveryModal" hidden role="dialog" aria-modal="true" aria-labelledby="saveRecoveryTitle">
      <div class="modal-card">
        <h3 id="saveRecoveryTitle">文件保存失败 · 导出已暂停</h3>
        <p id="saveRecoveryInfo"></p>
        <div class="modal-actions">
          <button id="saveRetry">重试保存</button>
          <button class="primary-action" id="saveAs">另存为</button>
          <button id="saveDiscard">放弃并终止</button>
        </div>
      </div>
    </div>`;

  document.documentElement.appendChild(host);

  const $ = (selector) => shadow.querySelector(selector);
  ui = {
    panel: $('.panel'),
    status: $('.status'),
    direction: $('#direction'),
    ratio: $('#ratio'),
    uniformTurns: $('#uniformTurns'),
    uniformDuration: $('#uniformDuration'),
    transitionTurns: $('#transitionTurns'),
    acceleration: $('#acceleration'),
    cruise: $('#cruise'),
    deceleration: $('#deceleration'),
    countdown: $('#countdown'),
    settle: $('#settle'),
    autoHide: $('#autoHide'),
    recordEnabled: $('#recordEnabled'),
    recordingScope: $('#recordingScope'),
    recordingFps: $('#recordingFps'),
    videoBitrate: $('#videoBitrate'),
    showAxisInOutput: $('#showAxisInOutput'),
    transparentOutput: $('#transparentOutput'),
    studioLighting: $('#studioLighting'),
    lightingEnvironment: $('#lightingEnvironment'),
    lightingDirect: $('#lightingDirect'),
    lightingExposure: $('#lightingExposure'),
    brightSolid: $('#brightSolid'),
    solidLift: $('#solidLift'),
    projectName: $('#projectName'),
    projectNameModal: $('#projectNameModal'),
    projectNameInput: $('#projectNameInput'),
    batchStartModal: $('#batchStartModal'),
    saveRecoveryModal: $('#saveRecoveryModal'),
    saveRecoveryInfo: $('#saveRecoveryInfo'),
    saveRetry: $('#saveRetry'),
    saveAs: $('#saveAs'),
    saveDiscard: $('#saveDiscard'),
    mainPage: $('#mainPage'), projectsPage: $('#projectsPage'),
    projectSearch: $('#projectSearch'), projectList: $('#projectList'),
    exportAll: $('#exportAll'), batchMenu: $('#batchMenu'), batchToggle: $('#batchToggle'),
  };

  syncUI();
  syncProjectNameField();
  initializeBatchMenu();
  $('#openProjects').addEventListener('click', () => showProjectLibrary(true));
  $('#backProjects').addEventListener('click', () => showProjectLibrary(false));
  ui.projectSearch.addEventListener('input', renderProjectLibrary);
  ui.batchToggle.addEventListener('click', () => {
    if (projectSwitchBlocked()) return;
    syncBatchSelection();
    ui.batchMenu.hidden = !ui.batchMenu.hidden;
    ui.batchToggle.setAttribute('aria-expanded', String(!ui.batchMenu.hidden));
  });
  $('#uniform').addEventListener('click', () => void runExportAction(() => handleRotationClick('uniform')));
  $('#transition').addEventListener('click', () => void runExportAction(() => handleRotationClick('transition')));
  $('#screenshot').addEventListener('click', () => void runExportAction(handleScreenshotClick));
  $('#exportAll').addEventListener('click', () => void runExportAction(exportAll));
  $('#stop').addEventListener('click', () => stopRotation());
  $('#hide').addEventListener('click', () => showPanel(false, true));
  $('#checkFrameEntry').addEventListener('click', () => void runExportAction(checkFrameEntry));
  $('#renameProject').addEventListener('click', () => void requestProjectName(true));
  ui.projectName.addEventListener('change', () => {
    if (ui.projectName.value.trim()) saveProjectName(ui.projectName.value);
  });
  $('#projectNameConfirm').addEventListener('click', () => finishProjectName(ui.projectNameInput.value));
  $('#projectNameCancel').addEventListener('click', () => finishProjectName(null));
  $('#projectNameSkip').addEventListener('click', () => finishProjectName(null, true));
  ui.projectNameInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') finishProjectName(ui.projectNameInput.value);
    if (event.key === 'Escape') finishProjectName(null);
  });
  $('#batchStartConfirm').addEventListener('click', () => finishBatchCaptureStart(true));
  $('#batchStartCancel').addEventListener('click', () => finishBatchCaptureStart(false));
  ui.saveRetry.addEventListener('click', () => void resumePendingSave(false));
  ui.saveAs.addEventListener('click', () => void resumePendingSave(true));
  ui.saveDiscard.addEventListener('click', discardPendingSave);
  $('#minus').addEventListener('click', () => {
    sanitizeSettingsFromUI();
    settings.pixelsPerTurnRatio = Math.max(0.2, settings.pixelsPerTurnRatio * 0.99);
    saveSettings(); syncUI(); setStatus('一圈距离已减少 1%', 'ready');
  });
  $('#plus').addEventListener('click', () => {
    sanitizeSettingsFromUI();
    settings.pixelsPerTurnRatio = Math.min(3, settings.pixelsPerTurnRatio * 1.01);
    saveSettings(); syncUI(); setStatus('一圈距离已增加 1%', 'ready');
  });

  shadow.addEventListener('change', () => {
    if (exportBusy || batchRunning || activeRun || pendingSave) { syncUI(); return; }
    sanitizeSettingsFromUI();
  });

  document.addEventListener('keydown', (event) => {
    const target = event.composedPath?.()[0] || event.target;
    const editing = target && (target.matches?.('input, textarea, select') || target.isContentEditable);

    if (event.key === 'Escape' && activeRun) {
      event.preventDefault();
      stopRotation();
      return;
    }
    if (editing || !event.altKey) return;

    if (event.code === 'Digit1') {
      event.preventDefault();
      void runExportAction(() => handleRotationClick('uniform'));
    } else if (event.code === 'Digit2') {
      event.preventDefault();
      void runExportAction(() => handleRotationClick('transition'));
    } else if (event.code === 'KeyH') {
      event.preventDefault();
      showPanel(!panelVisible, true);
      if (!panelVisible) return;
      refreshCanvasStatus();
    } else if (event.code === 'KeyS') {
      event.preventDefault();
      void runExportAction(handleScreenshotClick);
    }
  }, true);

  document.addEventListener('visibilitychange', () => {
    // Strict capture owns visibility handling, retaining the same pending frame.
    // Only the non-recording mouse-drag preview still stops on backgrounding.
    if (document.hidden && activeRun && !activeRun.strictFrames && !pendingSave && !activeRun.recording?.finalized) {
      stopRotation('页面进入后台，已安全停止');
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (pendingSave || activeRun?.recording?.finalized) {
      event.preventDefault();
      event.returnValue = '';
      return;
    }
    if (activeRun) stopRotation('页面切换，已安全停止');
  });

  refreshCanvasStatus();
  canvasStatusTimer = window.setInterval(refreshCanvasStatus, 2500);
})();
