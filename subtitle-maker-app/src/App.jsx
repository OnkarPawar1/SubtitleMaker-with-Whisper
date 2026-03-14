import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, Square, Image as ImageIcon, Type, Download, Settings, Upload, MonitorPlay, Film, Volume2, VolumeX, Music, Key, Layers, Trash2, Move } from 'lucide-react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const waitForNextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
const getDesktopBridge = () => (typeof window !== 'undefined' ? window.subtitleStudio ?? null : null);

const getSupportedRecordingFormat = () => {
  if (typeof MediaRecorder === 'undefined') return null;

  const candidates = [
    { mimeType: 'video/mp4;codecs=h264,aac', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];

  return candidates.find(({ mimeType }) => MediaRecorder.isTypeSupported(mimeType)) || null;
};

// --- Utility Functions ---
const parseSRT = (data) => {
  const normalize = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalize.split('\n\n').filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split('\n');
    if (lines.length >= 3) {
      const id = lines[0];
      const timecode = lines[1];
      const text = lines.slice(2).join('\n');
      const [startString, endString] = timecode.split(' --> ');
      return { id, startTime: timeMs(startString), endTime: timeMs(endString), text };
    }
    return null;
  }).filter(Boolean);
};

const timeMs = (val) => {
  if (!val) return 0;
  const match = val.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (!match) return 0;
  const [, h, m, s, ms] = match;
  return parseInt(h) * 3600000 + parseInt(m) * 60000 + parseInt(s) * 1000 + parseInt(ms);
};

const formatTime = (ms) => {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

const wrapText = (ctx, text, maxWidth) => {
  const lines = [];
  const rawLines = text.split('\n');
  rawLines.forEach(rawLine => {
    const words = rawLine.split(' ');
    let currentLine = '';
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine + word + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && i > 0) {
        lines.push(currentLine.trim());
        currentLine = word + ' ';
      } else {
        currentLine = testLine;
      }
    }
    lines.push(currentLine.trim());
  });
  return lines;
};

const DEFAULT_SRT = `1
00:00:00,000 --> 00:00:02,000
\u0938\u094d\u0935\u0924\u0903 \u0906\u0928\u0902\u0926\u0940 \u0930\u093e\u0939\u093e.

2
00:00:02,500 --> 00:00:04,500
\u0938\u094d\u0935\u0924\u0903\u091a\u094d\u092f\u093e \u0906\u0930\u094b\u0917\u094d\u092f\u093e\u091a\u0940 \u0915\u093e\u0933\u091c\u0940 \u0918\u0947.

3
00:00:05,000 --> 00:00:07,000
\u0938\u094d\u0935\u0924\u0903 \u0938\u093e\u0920\u0940 \u091c\u0917.

4
00:00:07,500 --> 00:00:09,500
\u0938\u094d\u0935\u0924\u0903\u091a\u093e \u091b\u0902\u0926 \u091c\u094b\u092a\u093e\u0938\u093e.

5
00:00:10,000 --> 00:00:12,000
\u0938\u094d\u0935\u0924\u0903\u091a\u0947 \u0928\u093f\u0930\u094d\u0923\u092f \u0938\u094d\u0935\u0924\u0903 \u0918\u0947.

6
00:00:12,500 --> 00:00:14,500
\u0938\u094d\u0935\u0924\u0903\u091a\u0947 \u0938\u094d\u0935\u092a\u094d\u0928 \u0938\u094d\u0935\u0924\u0903 \u092a\u0942\u0930\u094d\u0923 \u0915\u0930.

7
00:00:15,000 --> 00:00:17,000
\u0938\u094d\u0935\u0924\u0903 \u0915\u0941\u091f\u0941\u0902\u092c\u093e\u091a\u093e \u0935\u093f\u0915\u093e\u0938 \u0915\u0930.

8
00:00:17,500 --> 00:00:19,500
\u0938\u094d\u0935\u0924\u0903\u091a\u0940 \u0913\u0933\u0916 \u0938\u094d\u0935\u0924\u0903 \u0928\u093f\u0930\u094d\u092e\u093e\u0923 \u0915\u0930.

9
00:00:20,000 --> 00:00:23,000
\u092e\u0939\u093f\u0932\u093e \u0938\u0915\u094d\u0937\u092e\u0940\u0915\u0930\u0923`;

export default function App() {
  const desktopBridge = getDesktopBridge();
  const isDesktopApp = Boolean(desktopBridge?.isDesktop);
  const canvasRef = useRef(null);
  const bgVideoRef = useRef(null);
  const audioRef = useRef(null);
  const bgmRef = useRef(null);
  const audioCtxRef = useRef(null);
  const reqRef = useRef();
  const lastTimeRef = useRef();
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const ffmpegRef = useRef(new FFmpeg());

  const [activeTab, setActiveTab] = useState('subtitles');
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);

  // Load FFmpeg
  useEffect(() => {
    if (isDesktopApp) {
      setFfmpegLoaded(false);
      return;
    }

    (async () => {
      try {
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
        await ffmpegRef.current.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        setFfmpegLoaded(true);
      } catch (e) { console.error("FFmpeg load failed", e); }
    })();
  }, [isDesktopApp]);

  useEffect(() => {
    if (!isDesktopApp) return;

    desktopBridge.getExportSupport()
      .then(setDesktopExportSupport)
      .catch((error) => {
        console.error('Desktop export support check failed', error);
        setExportMessage('Desktop export support could not be verified. Raw recording save will still be attempted.');
      });
  }, [desktopBridge, isDesktopApp]);

  // --- ALL ORIGINAL STATE ---
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [srtInput, setSrtInput] = useState(DEFAULT_SRT);
  const [subtitles, setSubtitles] = useState([]);
  const [bgType, setBgType] = useState('color');
  const [bgColor, setBgColor] = useState('#1e293b');
  const [bgImageFile, setBgImageFile] = useState(null);
  const [bgImageObj, setBgImageObj] = useState(null);
  const [bgVideoFile, setBgVideoFile] = useState(null);
  const [bgVideoUrl, setBgVideoUrl] = useState(null);
  const [bgAnimation, setBgAnimation] = useState('none');
  const [audioFile, setAudioFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [bgmFile, setBgmFile] = useState(null);
  const [bgmUrl, setBgmUrl] = useState(null);
  const [videoVolume, setVideoVolume] = useState(1);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [audioVolume, setAudioVolume] = useState(1);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [bgmVolume, setBgmVolume] = useState(0.3);
  const [isBgmMuted, setIsBgmMuted] = useState(false);
  const [googleFontsApiKey, setGoogleFontsApiKey] = useState('');
  const [fetchedGoogleFonts, setFetchedGoogleFonts] = useState([]);
  const [isLoadingFonts, setIsLoadingFonts] = useState(false);
  const [customFonts, setCustomFonts] = useState([]);

  const DEVANAGARI_FONTS = ['Mukta', 'Noto Sans Devanagari', 'Yantramanav', 'Hind', 'Tiro Devanagari Marathi', 'Gotu', 'Khand', 'Rozha One', 'Poppins'];

  const [textStyle, setTextStyle] = useState({
    fontFamily: 'sans-serif', fontSize: 60, color: '#ffffff', shadow: true,
    animation: 'pop', position: 'center',
    displayMode: 'block', // 'block', 'highlight', 'word'
  });

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [totalDuration, setTotalDuration] = useState(10000);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingProgress, setRecordingProgress] = useState(0);
  const [exportMessage, setExportMessage] = useState('');
  const [desktopExportSupport, setDesktopExportSupport] = useState({
    isDesktop: isDesktopApp,
    ffmpegAvailable: false,
    platform: null,
  });

  // --- NEW: Overlays & Drag State ---
  const [overlays, setOverlays] = useState([]);
  const [activeOverlayId, setActiveOverlayId] = useState(null);
  const [subPos, setSubPos] = useState({ x: 0.5, y: 0.8 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [dragMode, setDragMode] = useState(false); // toggle for subtitle drag

  const canvasWidth = aspectRatio === '16:9' ? 1280 : 720;
  const canvasHeight = aspectRatio === '16:9' ? 720 : 1280;

  // --- Effects ---
  useEffect(() => {
    try {
      const parsed = parseSRT(srtInput);
      setSubtitles(parsed);
      if (parsed.length > 0) setTotalDuration(parsed[parsed.length - 1].endTime + 1000);
    } catch (e) { console.error("Error parsing SRT", e); }
  }, [srtInput]);

  useEffect(() => { if (bgType === 'image' && bgImageFile) { const img = new Image(); img.onload = () => setBgImageObj(img); img.src = URL.createObjectURL(bgImageFile); } }, [bgType, bgImageFile]);
  useEffect(() => { if (bgVideoFile) setBgVideoUrl(URL.createObjectURL(bgVideoFile)); }, [bgVideoFile]);
  useEffect(() => { if (audioFile) setAudioUrl(URL.createObjectURL(audioFile)); }, [audioFile]);
  useEffect(() => { if (bgmFile) setBgmUrl(URL.createObjectURL(bgmFile)); }, [bgmFile]);
  useEffect(() => { if (bgVideoRef.current) bgVideoRef.current.volume = isVideoMuted ? 0 : videoVolume; }, [videoVolume, isVideoMuted]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = isAudioMuted ? 0 : audioVolume; }, [audioVolume, isAudioMuted]);
  useEffect(() => { if (bgmRef.current) bgmRef.current.volume = isBgmMuted ? 0 : bgmVolume; }, [bgmVolume, isBgmMuted]);

  // --- Handlers ---
  const handleSrtUpload = (e) => { const file = e.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = (evt) => setSrtInput(evt.target.result); reader.readAsText(file); };

  const handleFontUpload = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const familyName = `CustomFont_${Date.now()}`;
    try {
      const fontFace = new FontFace(familyName, `url(${URL.createObjectURL(file)})`);
      const loadedFont = await fontFace.load(); document.fonts.add(loadedFont);
      setCustomFonts(prev => [...prev, { name: file.name, family: familyName }]);
      setTextStyle(prev => ({ ...prev, fontFamily: familyName }));
    } catch { alert("Failed to load font."); }
  };

  const fetchGoogleFonts = async () => {
    if (!googleFontsApiKey) return alert("Please enter a Google Fonts API Key");
    setIsLoadingFonts(true);
    try {
      const response = await fetch(`https://www.googleapis.com/webfonts/v1/webfonts?key=${googleFontsApiKey}&sort=popularity`);
      const data = await response.json(); if (data.error) throw new Error(data.error.message);
      const devanagariFonts = data.items.filter(font => font.subsets.includes('devanagari'));
      setFetchedGoogleFonts(devanagariFonts.length > 0 ? devanagariFonts : data.items.slice(0, 100));
    } catch { alert("Failed to fetch fonts."); } finally { setIsLoadingFonts(false); }
  };

  const handleSelectGoogleFont = (fontFamily) => {
    const url = `https://fonts.googleapis.com/css2?family=${fontFamily.replace(/ /g, '+')}&display=swap`;
    if (!document.querySelector(`link[href="${url}"]`)) {
      const link = document.createElement('link'); link.href = url; link.rel = 'stylesheet'; document.head.appendChild(link);
    }
    setTextStyle(prev => ({ ...prev, fontFamily }));
  };

  // --- Canvas Mouse (Dragging) ---
  const handleMouseDown = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = canvasWidth / rect.width, sy = canvasHeight / rect.height;
    const mx = (e.clientX - rect.left) * sx, my = (e.clientY - rect.top) * sy;
    for (let i = overlays.length - 1; i >= 0; i--) {
      const ov = overlays[i];
      const ow = ov.type === 'image' ? ov.w * ov.scale : 200;
      const oh = ov.type === 'image' ? ov.h * ov.scale : ov.fontSize * ov.scale;
      if (mx >= ov.x && mx <= ov.x + ow && my >= ov.y && my <= ov.y + oh) {
        setIsDragging(ov.id); setDragOffset({ x: mx - ov.x, y: my - ov.y }); setActiveOverlayId(ov.id); return;
      }
    }
    if (dragMode) {
      const subX = canvasWidth * subPos.x, subY = canvasHeight * subPos.y;
      if (Math.abs(mx - subX) < 300 && Math.abs(my - subY) < 100) {
        setIsDragging('subtitle'); setDragOffset({ x: mx - subX, y: my - subY }); setActiveOverlayId(null); return;
      }
    }
    setActiveOverlayId(null);
  };
  const handleMouseMove = (e) => {
    if (!isDragging) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = canvasWidth / rect.width, sy = canvasHeight / rect.height;
    const mx = (e.clientX - rect.left) * sx, my = (e.clientY - rect.top) * sy;
    if (isDragging === 'subtitle') {
      setSubPos({ x: Math.max(0, Math.min(1, (mx - dragOffset.x) / canvasWidth)), y: Math.max(0, Math.min(1, (my - dragOffset.y) / canvasHeight)) });
    } else {
      setOverlays(prev => prev.map(ov => ov.id === isDragging ? { ...ov, x: mx - dragOffset.x, y: my - dragOffset.y } : ov));
    }
  };
  const handleMouseUp = () => setIsDragging(false);

  // --- Draw Frame (FULL ORIGINAL + Overlays + Drag) ---
  const drawFrame = useCallback((time) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // 1. Background
    const mediaObj = bgType === 'video' ? bgVideoRef.current : (bgType === 'image' ? bgImageObj : null);
    const isVideoReady = bgType === 'video' && mediaObj && mediaObj.readyState >= 2;

    if (mediaObj && (bgType === 'image' || isVideoReady)) {
      const mediaWidth = mediaObj.videoWidth || mediaObj.width;
      const mediaHeight = mediaObj.videoHeight || mediaObj.height;
      const mediaRatio = mediaWidth / mediaHeight;
      const canvasRatio = width / height;
      let drawW = width, drawH = height, offsetX = 0, offsetY = 0;
      if (mediaRatio > canvasRatio) { drawW = height * mediaRatio; offsetX = (width - drawW) / 2; }
      else { drawH = width / mediaRatio; offsetY = (height - drawH) / 2; }

      ctx.save();
      if (bgAnimation !== 'none') {
        const loopTime = 15000;
        let progress = (time % loopTime) / loopTime;
        let scale = 1;
        if (bgAnimation === 'zoomIn') scale = 1 + (progress * 0.3);
        else if (bgAnimation === 'zoomOut') scale = 1.3 - (progress * 0.3);
        ctx.translate(width / 2, height / 2); ctx.scale(scale, scale); ctx.translate(-width / 2, -height / 2);
      }
      ctx.drawImage(mediaObj, offsetX, offsetY, drawW, drawH);
      ctx.restore();
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(0, 0, width, height);
    } else {
      ctx.fillStyle = bgColor; ctx.fillRect(0, 0, width, height);
    }

    // 2. NEW: Draw Overlays
    overlays.forEach(ov => {
      ctx.globalAlpha = ov.opacity ?? 1;
      if (ov.type === 'image' && ov.obj) {
        const dw = ov.w * ov.scale, dh = ov.h * ov.scale;
        ctx.drawImage(ov.obj, ov.x, ov.y, dw, dh);
        if (activeOverlayId === ov.id) { ctx.strokeStyle = '#818cf8'; ctx.lineWidth = 3; ctx.setLineDash([8, 4]); ctx.strokeRect(ov.x - 2, ov.y - 2, dw + 4, dh + 4); ctx.setLineDash([]); }
      } else if (ov.type === 'text') {
        ctx.font = `bold ${ov.fontSize * ov.scale}px sans-serif`;
        const m = ctx.measureText(ov.text);
        const pad = 12;
        // Draw background rectangle if bgColor is set
        if (ov.bgColor && ov.bgColor !== 'transparent') {
          ctx.fillStyle = ov.bgColor;
          ctx.fillRect(ov.x - pad / 2, ov.y - pad / 2, m.width + pad, ov.fontSize * ov.scale + pad);
        }
        ctx.fillStyle = ov.color || '#ffffff'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 8; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
        ctx.fillText(ov.text, ov.x, ov.y);
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
        if (activeOverlayId === ov.id) { ctx.strokeStyle = '#818cf8'; ctx.lineWidth = 3; ctx.setLineDash([8, 4]); ctx.strokeRect(ov.x - pad / 2 - 2, ov.y - pad / 2 - 2, m.width + pad + 4, ov.fontSize * ov.scale + pad + 4); ctx.setLineDash([]); }
      }
    });
    ctx.globalAlpha = 1;

    // 3. Subtitles (FULL ORIGINAL animation engine)
    const activeSub = subtitles.find(sub => time >= sub.startTime && time <= sub.endTime);
    if (activeSub) {
      ctx.save();
      const duration = time - activeSub.startTime;
      const subTotalDuration = activeSub.endTime - activeSub.startTime;
      const timeRemaining = activeSub.endTime - time;
      let textToRender = activeSub.text;
      let animDuration = duration;
      let currentWordIndex = 0;

      if (textStyle.displayMode === 'word' || textStyle.displayMode === 'highlight') {
        const words = activeSub.text.split(/\s+/);
        const wordDuration = subTotalDuration / words.length;
        currentWordIndex = Math.min(Math.floor(duration / wordDuration), words.length - 1);
        if (textStyle.displayMode === 'word') {
          textToRender = words[currentWordIndex];
          animDuration = duration - (currentWordIndex * wordDuration);
        }
      }

      const baseAnimSpeed = 300;
      const animSpeed = textStyle.displayMode === 'word' ? Math.min(200, subTotalDuration / activeSub.text.split(/\s+/).length) : baseAnimSpeed;
      const t = Math.min(1, Math.max(0, animDuration / animSpeed));
      let globalAlpha = 1, yOffset = 0, xOffset = 0, scale = 1, rotation = 0, blurAmount = 0;

      switch (textStyle.animation) {
        case 'fade': globalAlpha = t; break;
        case 'slideUp': globalAlpha = t; yOffset = 50 * (1 - t); break;
        case 'slideDown': globalAlpha = t; yOffset = -50 * (1 - t); break;
        case 'zoomIn': globalAlpha = t; scale = 0.5 + 0.5 * t; break;
        case 'zoomOut': globalAlpha = t; scale = 1.5 - 0.5 * t; break;
        case 'pop': globalAlpha = t; scale = 0.5 + Math.sin(t * Math.PI) * 0.6 + t * 0.5; if (scale > 1) scale = 1 + (1 - t) * 0.2; break;
        case 'elastic': { globalAlpha = t; const c4 = (2 * Math.PI) / 3; scale = t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1; break; }
        case 'spinIn': globalAlpha = t; scale = t; rotation = (1 - t) * Math.PI * 2; break;
        case 'blurIn': globalAlpha = t; blurAmount = 10 * (1 - t); break;
        case 'typewriter': { const typeSpeedMs = textStyle.displayMode === 'word' ? 20 : 40; textToRender = textToRender.substring(0, Math.floor(animDuration / typeSpeedMs)); break; }
        default: break;
      }

      const fadeOutSpeed = 200;
      if (textStyle.displayMode !== 'word' && timeRemaining < fadeOutSpeed) globalAlpha = Math.max(0, timeRemaining / fadeOutSpeed);

      ctx.globalAlpha = Math.max(0, Math.min(1, globalAlpha));
      if (blurAmount > 0) ctx.filter = `blur(${blurAmount}px)`;

      ctx.font = `bold ${textStyle.fontSize}px ${textStyle.fontFamily}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (textStyle.shadow) { ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 10; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2; }

      const maxWidth = width * 0.85;
      const lines = wrapText(ctx, textToRender, maxWidth);
      const lineHeight = textStyle.fontSize * 1.3;
      const totalTextHeight = lines.length * lineHeight;

      // NEW: Use draggable subPos if dragMode enabled, else original position logic
      let startY;
      if (dragMode) {
        startY = height * subPos.y - totalTextHeight / 2;
      } else {
        if (textStyle.position === 'top') startY = height * 0.2;
        else if (textStyle.position === 'bottom') startY = height * 0.8 - totalTextHeight;
        else startY = (height - totalTextHeight) / 2 + (lineHeight / 2);
      }

      const centerX = dragMode ? width * subPos.x + xOffset : width / 2 + xOffset;
      const centerY = startY + totalTextHeight / 2 + yOffset - (lineHeight / 2);

      ctx.translate(centerX, centerY);
      if (rotation !== 0) ctx.rotate(rotation);
      if (scale !== 1) ctx.scale(scale, scale);
      ctx.translate(-centerX, -centerY);

      if (textStyle.displayMode === 'highlight') {
        ctx.textAlign = 'left';
        let globalWordCounter = 0;
        lines.forEach((line, index) => {
          const lineY = startY + index * lineHeight + yOffset;
          const lineWords = line.split(' ');
          const lineWidth = ctx.measureText(line).width;
          let currentX = centerX - (lineWidth / 2);
          lineWords.forEach((word) => {
            const isActive = globalWordCounter <= currentWordIndex;
            ctx.globalAlpha = isActive ? Math.max(0, Math.min(1, globalAlpha)) : Math.max(0, Math.min(1, globalAlpha)) * 0.3;
            ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.strokeText(word, currentX, lineY);
            ctx.fillStyle = textStyle.color; ctx.fillText(word, currentX, lineY);
            currentX += ctx.measureText(word + ' ').width;
            globalWordCounter++;
          });
        });
      } else {
        ctx.textAlign = 'center';
        lines.forEach((line, index) => {
          const lineY = startY + index * lineHeight + yOffset;
          ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.strokeText(line, centerX, lineY);
          ctx.fillStyle = textStyle.color; ctx.fillText(line, centerX, lineY);
        });
      }
      ctx.filter = 'none';
      ctx.restore();
    }
  }, [subtitles, bgType, bgImageObj, bgColor, textStyle, bgAnimation, overlays, activeOverlayId, subPos, dragMode]);

  useEffect(() => { drawFrame(currentTime); }, [drawFrame, currentTime]);

  // Animation Loop
  const animate = useCallback((timestamp) => {
    if (lastTimeRef.current !== undefined) {
      const delta = timestamp - lastTimeRef.current;
      setCurrentTime(prev => {
        const nextTime = prev + delta;
        if (nextTime >= totalDuration) { setIsPlaying(false); if (isRecording) stopRecording(); return totalDuration; }
        if (isRecording) setRecordingProgress((nextTime / totalDuration) * 100);
        return nextTime;
      });
    }
    lastTimeRef.current = timestamp;
    if (isPlaying) reqRef.current = requestAnimationFrame(animate);
  }, [isPlaying, totalDuration, isRecording]);

  useEffect(() => {
    if (isPlaying) {
      lastTimeRef.current = performance.now(); reqRef.current = requestAnimationFrame(animate);
      if (bgType === 'video' && bgVideoRef.current) bgVideoRef.current.play().catch(() => { });
      if (audioRef.current) audioRef.current.play().catch(() => { });
      if (bgmRef.current) bgmRef.current.play().catch(() => { });
    } else {
      lastTimeRef.current = undefined; cancelAnimationFrame(reqRef.current);
      if (bgVideoRef.current) bgVideoRef.current.pause();
      if (audioRef.current) audioRef.current.pause();
      if (bgmRef.current) bgmRef.current.pause();
    }
    return () => cancelAnimationFrame(reqRef.current);
  }, [isPlaying, animate, bgType]);

  const handleSeek = (pos) => {
    if (isRecording) return;
    const newTime = pos * totalDuration; setCurrentTime(newTime);
    if (bgVideoRef.current) bgVideoRef.current.currentTime = newTime / 1000;
    if (audioRef.current) audioRef.current.currentTime = newTime / 1000;
    if (bgmRef.current) bgmRef.current.currentTime = newTime / 1000;
  };

  const saveRecordingBlob = useCallback(async (blob, extension, preferMp4 = false) => {
    const defaultBaseName = `SubtitleStudio-${Date.now()}`;

    if (isDesktopApp) {
      try {
        const result = await desktopBridge.saveRecording({
          arrayBuffer: await blob.arrayBuffer(),
          mimeType: blob.type,
          defaultFileName: defaultBaseName,
          preferMp4,
        });

        if (result?.canceled) {
          setExportMessage('Export canceled.');
          return;
        }

        if (result?.filePath) {
          setExportMessage(`Saved export to ${result.filePath}`);
        }
        return;
      } catch (error) {
        console.error('Desktop save failed', error);
        setExportMessage(`Desktop export failed: ${error.message}`);
        alert(`Desktop export failed: ${error.message}`);
        return;
      }
    }

    dlFallback(blob, extension);
  }, [desktopBridge, isDesktopApp]);

  // HD MP4 Export with FFmpeg
  const startRecording = async () => {
    if (!canvasRef.current) return;
    const recordingFormat = getSupportedRecordingFormat();
    if (!recordingFormat) {
      alert(isDesktopApp ? 'This Electron runtime cannot record the canvas on this machine.' : 'This browser does not support recording this canvas. Use desktop Chrome for export.');
      return;
    }

    const isGitHubPages = window.location.hostname.endsWith('github.io');
    const canConvertToMp4 = isDesktopApp
      ? desktopExportSupport.ffmpegAvailable && recordingFormat.extension === 'webm'
      : ffmpegLoaded && !isGitHubPages && recordingFormat.extension === 'webm';

    if (!isDesktopApp && !ffmpegLoaded && recordingFormat.extension === 'webm') {
      const proceed = window.confirm('FFmpeg is not available, so the export will be downloaded as WebM.\n\nTip: GitHub Pages cannot reliably run the MP4 conversion path used locally.\n\nProceed with WebM export?');
      if (!proceed) return;
    }

    if (isDesktopApp) {
      setExportMessage(desktopExportSupport.ffmpegAvailable
        ? 'Desktop export will use the native save dialog and local FFmpeg conversion when needed.'
        : 'Desktop export will save the raw recording directly because bundled FFmpeg is unavailable.');
    } else if (isGitHubPages) {
      setExportMessage('GitHub Pages export is browser-limited. Chrome works best; MP4 conversion is disabled here.');
    } else {
      setExportMessage('');
    }

    setCurrentTime(0);
    drawFrame(0);
    if (bgVideoRef.current) bgVideoRef.current.currentTime = 0;
    if (audioRef.current) audioRef.current.currentTime = 0;
    if (bgmRef.current) bgmRef.current.currentTime = 0;
    setRecordingProgress(0);
    setIsRecording(true);
    await waitForNextFrame();

    const stream = canvasRef.current.captureStream(30);
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
      const dest = audioCtxRef.current.createMediaStreamDestination();
      const audioSources = [
        { el: audioRef.current, vol: audioVolume, muted: isAudioMuted },
        { el: bgType === 'video' ? bgVideoRef.current : null, vol: videoVolume, muted: isVideoMuted },
        { el: bgmRef.current, vol: bgmVolume, muted: isBgmMuted }
      ];
      audioSources.forEach(({ el, vol, muted }) => {
        if (el) {
          if (!el._sourceNode) { el._sourceNode = audioCtxRef.current.createMediaElementSource(el); el._gainNode = audioCtxRef.current.createGain(); el._sourceNode.connect(el._gainNode); }
          el._gainNode.gain.value = muted ? 0 : vol;
          el._gainNode.disconnect(); el._gainNode.connect(audioCtxRef.current.destination); el._gainNode.connect(dest);
        }
      });
      const audioTracks = dest.stream.getAudioTracks();
      if (audioTracks.length > 0) stream.addTrack(audioTracks[0]);
    } catch (e) { console.error("Audio mixing failed", e); }

    mediaRecorderRef.current = new MediaRecorder(stream, {
      mimeType: recordingFormat.mimeType,
      videoBitsPerSecond: 15000000,
    });
    recordedChunksRef.current = [];
    mediaRecorderRef.current.ondataavailable = (e) => { if (e.data.size > 0) recordedChunksRef.current.push(e.data); };
    mediaRecorderRef.current.onstop = async () => {
      const blob = new Blob(recordedChunksRef.current, { type: recordingFormat.mimeType });

      if (blob.size < 32768) {
        setIsRecording(false);
        setExportMessage('Export failed: the browser produced an empty recording. Use desktop Chrome on the live site or run locally.');
        alert('Export failed: the browser produced an empty recording. Use desktop Chrome on the live site or run the app locally.');
        return;
      }

      if (canConvertToMp4) {
        try {
          setRecordingProgress(60);
          if (isDesktopApp) {
            await saveRecordingBlob(blob, recordingFormat.extension, true);
            setRecordingProgress(100);
          } else {
            const ffmpeg = ffmpegRef.current;
            await ffmpeg.writeFile('input.webm', await fetchFile(blob));
            setRecordingProgress(80);
            await ffmpeg.exec(['-i', 'input.webm', '-c:v', 'libx264', '-crf', '18', '-preset', 'fast', '-c:a', 'aac', 'output.mp4']);
            setRecordingProgress(100);
            const data = await ffmpeg.readFile('output.mp4');
            const mp4Blob = new Blob([data.buffer], { type: 'video/mp4' });
            await saveRecordingBlob(mp4Blob, 'mp4');
          }
        } catch (err) { console.error(err); alert('MP4 conversion failed. Downloading the recorded file instead.'); await saveRecordingBlob(blob, recordingFormat.extension); }
      } else { await saveRecordingBlob(blob, recordingFormat.extension); }
      setIsRecording(false);
    };
    setIsPlaying(true);
    await waitForNextFrame();
    mediaRecorderRef.current.start(1000);
  };

  const stopRecording = () => { if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop(); };
  const dlFallback = (b, extension = 'webm') => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `SubtitleStudio-${Date.now()}.${extension}`;
    a.click();
  };

  const togglePlay = () => {
    if (currentTime >= totalDuration) { setCurrentTime(0); if (bgVideoRef.current) bgVideoRef.current.currentTime = 0; if (audioRef.current) audioRef.current.currentTime = 0; if (bgmRef.current) bgmRef.current.currentTime = 0; }
    setIsPlaying(!isPlaying);
  };

  // Overlay Handlers
  const addTextOverlay = () => setOverlays(p => [...p, { id: Date.now(), type: 'text', text: 'New Title', x: 100, y: 100, fontSize: 60, color: '#ffffff', bgColor: 'transparent', scale: 1, opacity: 1 }]);
  const addImageOverlay = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const img = new Image();
    img.onload = () => setOverlays(p => [...p, { id: Date.now(), type: 'image', obj: img, x: 50, y: 50, w: img.width, h: img.height, scale: 0.3, opacity: 1 }]);
    img.src = URL.createObjectURL(file);
  };

  const tabs = [
    { id: 'subtitles', label: 'Subtitles', icon: <Type className="w-4 h-4" /> },
    { id: 'background', label: 'Media & BG', icon: <ImageIcon className="w-4 h-4" /> },
    { id: 'style', label: 'Styling', icon: <Settings className="w-4 h-4" /> },
    { id: 'overlays', label: 'Overlays', icon: <Layers className="w-4 h-4" /> },
  ];

  return (
    <div className="min-h-screen bg-slate-900 text-slate-200 flex flex-col font-sans">
      <header className="bg-slate-950 border-b border-slate-800 p-4 flex items-center justify-between shadow-lg z-20">
        <div className="flex items-center gap-2">
          <Film className="w-6 h-6 text-indigo-400" />
          <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">Subtitle Studio</h1>
        </div>
        <button onClick={startRecording} disabled={isRecording || subtitles.length === 0}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${isRecording ? 'bg-rose-500/20 text-rose-400 cursor-not-allowed animate-pulse' : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-900/50'}`}>
          {isRecording ? <div className="w-4 h-4 rounded-full bg-rose-500" /> : <Download className="w-4 h-4" />}
          {isRecording ? `Exporting... ${Math.round(recordingProgress)}%` : 'Export HD MP4'}
        </button>
      </header>

      {exportMessage && (
        <div className="border-b border-amber-800 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
          {exportMessage}
        </div>
      )}

      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {bgVideoUrl && <video ref={bgVideoRef} src={bgVideoUrl} loop crossOrigin="anonymous" className="hidden" playsInline />}
        {audioUrl && <audio ref={audioRef} src={audioUrl} crossOrigin="anonymous" className="hidden" />}
        {bgmUrl && <audio ref={bgmRef} src={bgmUrl} loop crossOrigin="anonymous" className="hidden" />}

        {/* Left Panel */}
        <div className="w-full lg:w-96 border-r border-slate-800 flex flex-col bg-slate-900 shadow-xl z-10">
          <div className="flex border-b border-slate-800">
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex-1 py-3 text-sm font-medium flex justify-center items-center gap-1 ${activeTab === tab.id ? 'text-indigo-400 border-b-2 border-indigo-400 bg-slate-800/50' : 'text-slate-400 hover:bg-slate-800/30'}`}>
                {tab.icon} <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">

            {/* SUBTITLES TAB */}
            {activeTab === 'subtitles' && (
              <div className="flex flex-col h-full gap-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Paste SRT Text</label>
                  <label className="bg-slate-800 hover:bg-slate-700 text-indigo-300 text-xs px-2 py-1 rounded cursor-pointer flex items-center gap-1">
                    <Upload className="w-3 h-3" /> Upload .srt
                    <input type="file" accept=".srt" className="hidden" onChange={handleSrtUpload} />
                  </label>
                </div>
                <textarea className="flex-1 bg-slate-950 border border-slate-700 rounded-lg p-3 text-sm text-slate-300 font-mono resize-none focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
                  value={srtInput} onChange={(e) => setSrtInput(e.target.value)} />
                <label className="flex items-center gap-2 p-2 bg-slate-950 rounded border border-slate-800 cursor-pointer mt-2">
                  <input type="checkbox" checked={dragMode} onChange={(e) => setDragMode(e.target.checked)} className="w-4 h-4 accent-indigo-500" />
                  <span className="text-xs text-slate-300"><Move className="w-3 h-3 inline" /> Enable subtitle drag on canvas</span>
                </label>
              </div>
            )}

            {/* MEDIA & BG TAB */}
            {activeTab === 'background' && (
              <div className="flex flex-col gap-6">
                <div className="space-y-3">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Video Format</label>
                  <div className="bg-slate-950 p-1 rounded-lg flex gap-1">
                    <button onClick={() => setAspectRatio('16:9')} className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${aspectRatio === '16:9' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>16:9 (Horizontal)</button>
                    <button onClick={() => setAspectRatio('9:16')} className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${aspectRatio === '9:16' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>9:16 (Vertical)</button>
                  </div>
                </div>
                <hr className="border-slate-800" />
                <div className="space-y-3">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Voiceover Audio</label>
                  <label className="border-2 border-dashed border-slate-700 rounded-xl p-4 flex flex-col items-center bg-slate-950/50 hover:bg-slate-900 cursor-pointer">
                    <Upload className="w-6 h-6 text-slate-500 mb-2" /><span className="text-sm text-slate-300">Upload Audio (MP3/WAV)</span>
                    <input type="file" accept="audio/*" className="hidden" onChange={(e) => { if (e.target.files[0]) setAudioFile(e.target.files[0]); }} />
                  </label>
                  {audioFile && <p className="text-xs text-indigo-400 truncate">Audio: {audioFile.name}</p>}
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Background Music</label>
                  <label className="border-2 border-dashed border-slate-700 rounded-xl p-4 flex flex-col items-center bg-slate-950/50 hover:bg-slate-900 cursor-pointer">
                    <Music className="w-6 h-6 text-slate-500 mb-2" /><span className="text-sm text-slate-300">Upload BGM (MP3/WAV)</span>
                    <input type="file" accept="audio/*" className="hidden" onChange={(e) => { if (e.target.files[0]) setBgmFile(e.target.files[0]); }} />
                  </label>
                  {bgmFile && <p className="text-xs text-indigo-400 truncate">BGM: {bgmFile.name}</p>}
                </div>
                <div className="space-y-3 bg-slate-950 p-3 rounded-lg border border-slate-800">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Volume Mixer</label>
                  {bgType === 'video' && (
                    <div className="flex items-center gap-3">
                      <button onClick={() => setIsVideoMuted(!isVideoMuted)} className="text-slate-400 hover:text-white">{isVideoMuted || videoVolume === 0 ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}</button>
                      <span className="text-xs text-slate-500 w-12">Video</span>
                      <input type="range" min="0" max="1" step="0.05" value={isVideoMuted ? 0 : videoVolume} onChange={(e) => { setVideoVolume(parseFloat(e.target.value)); setIsVideoMuted(false); }} className="flex-1 accent-indigo-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <button onClick={() => setIsAudioMuted(!isAudioMuted)} className="text-slate-400 hover:text-white">{isAudioMuted || audioVolume === 0 ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}</button>
                    <span className="text-xs text-slate-500 w-12">Voice</span>
                    <input type="range" min="0" max="1" step="0.05" value={isAudioMuted ? 0 : audioVolume} onChange={(e) => { setAudioVolume(parseFloat(e.target.value)); setIsAudioMuted(false); }} className="flex-1 accent-indigo-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
                  </div>
                  <div className="flex items-center gap-3">
                    <button onClick={() => setIsBgmMuted(!isBgmMuted)} className="text-slate-400 hover:text-white">{isBgmMuted || bgmVolume === 0 ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}</button>
                    <span className="text-xs text-slate-500 w-12">BGM</span>
                    <input type="range" min="0" max="1" step="0.05" value={isBgmMuted ? 0 : bgmVolume} onChange={(e) => { setBgmVolume(parseFloat(e.target.value)); setIsBgmMuted(false); }} className="flex-1 accent-indigo-500 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer" />
                  </div>
                </div>
                <hr className="border-slate-800" />
                <div className="space-y-3">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Background Layer</label>
                  <div className="bg-slate-950 p-1 rounded-lg flex gap-1">
                    {['color', 'image', 'video'].map(t => (
                      <button key={t} onClick={() => setBgType(t)} className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${bgType === t ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
                    ))}
                  </div>
                </div>
                {bgType === 'color' && (
                  <div className="flex gap-2">
                    <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="w-12 h-12 rounded cursor-pointer bg-slate-950 border border-slate-700" />
                    <input type="text" value={bgColor} onChange={(e) => setBgColor(e.target.value)} className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 text-sm focus:outline-none focus:border-indigo-500" />
                  </div>
                )}
                {(bgType === 'image' || bgType === 'video') && (
                  <div className="space-y-3">
                    <div className="border-2 border-dashed border-slate-700 rounded-xl p-8 flex flex-col items-center bg-slate-950/50 hover:bg-slate-900">
                      <Upload className="w-8 h-8 text-slate-500 mb-3" />
                      <label className="bg-slate-800 hover:bg-slate-700 text-white text-sm px-4 py-2 rounded-lg cursor-pointer mt-4">
                        Browse Files
                        <input type="file" accept={bgType === 'image' ? "image/*" : "video/*"} className="hidden" onChange={(e) => { if (e.target.files[0]) bgType === 'image' ? setBgImageFile(e.target.files[0]) : setBgVideoFile(e.target.files[0]); }} />
                      </label>
                    </div>
                    {bgType === 'image' && bgImageFile && <p className="text-xs text-indigo-400 truncate">Selected: {bgImageFile.name}</p>}
                    {bgType === 'video' && bgVideoFile && <p className="text-xs text-indigo-400 truncate">Selected: {bgVideoFile.name}</p>}
                    <div className="mt-4 space-y-2">
                      <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Background Loop Animation</label>
                      <select value={bgAnimation} onChange={(e) => setBgAnimation(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-indigo-500">
                        <option value="none">None</option><option value="zoomIn">Continuous Zoom In</option><option value="zoomOut">Continuous Zoom Out</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* STYLING TAB */}
            {activeTab === 'style' && (
              <div className="flex flex-col gap-5">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-indigo-400 uppercase tracking-wider">Display Mode</label>
                  <select value={textStyle.displayMode} onChange={(e) => setTextStyle({ ...textStyle, displayMode: e.target.value })} className="w-full bg-slate-950 border border-indigo-500/50 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-indigo-500">
                    <option value="block">Full Phrase (Multi-line Block)</option>
                    <option value="highlight">Full Phrase (Highlight Words)</option>
                    <option value="word">Word by Word (Modern Shorts)</option>
                  </select>
                  <p className="text-[10px] text-slate-500">Word-by-Word dynamically animates each single word. Highlight fades upcoming words.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Animation Style</label>
                  <select value={textStyle.animation} onChange={(e) => setTextStyle({ ...textStyle, animation: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-indigo-500">
                    <option value="none">No Animation</option><option value="fade">Fade In</option><option value="typewriter">Typewriter</option>
                    <option value="slideUp">Slide Up</option><option value="slideDown">Slide Down</option>
                    <option value="zoomIn">Zoom In</option><option value="zoomOut">Zoom Out</option>
                    <option value="pop">Pop & Bounce</option><option value="elastic">Elastic Snap</option>
                    <option value="spinIn">Spin & Scale In</option><option value="blurIn">Blur In Reveal</option>
                  </select>
                </div>
                <hr className="border-slate-800" />
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Font Family</label>
                  <select value={textStyle.fontFamily} onChange={(e) => { const val = e.target.value; if (DEVANAGARI_FONTS.includes(val) || fetchedGoogleFonts.some(f => f.family === val)) handleSelectGoogleFont(val); else setTextStyle({ ...textStyle, fontFamily: val }); }} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-indigo-500">
                    <option value="sans-serif">System Default (Sans-Serif)</option><option value="serif">Serif</option><option value="Arial, sans-serif">Arial</option>
                    <optgroup label="Popular Marathi / Devanagari">
                      {DEVANAGARI_FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                    </optgroup>
                    {customFonts.length > 0 && <optgroup label="Custom Uploaded">{customFonts.map(f => <option key={f.family} value={f.family}>{f.name} (Custom)</option>)}</optgroup>}
                  </select>
                </div>
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-3">
                  <label className="text-xs font-semibold text-slate-400 uppercase flex items-center gap-1"><Key className="w-3 h-3" /> Google Fonts (Devanagari)</label>
                  <div className="flex gap-2">
                    <input type="password" placeholder="Enter API Key..." value={googleFontsApiKey} onChange={(e) => setGoogleFontsApiKey(e.target.value)} className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500" />
                    <button onClick={fetchGoogleFonts} disabled={isLoadingFonts} className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white text-xs px-3 py-2 rounded-lg">{isLoadingFonts ? 'Fetching...' : 'Fetch'}</button>
                  </div>
                  {fetchedGoogleFonts.length > 0 && (
                    <div className="max-h-32 overflow-y-auto custom-scrollbar border border-slate-800 rounded-md bg-slate-900 p-1 mt-2">
                      {fetchedGoogleFonts.map(font => (
                        <div key={font.family} onClick={() => handleSelectGoogleFont(font.family)} className="text-xs text-slate-300 hover:bg-indigo-600 hover:text-white px-2 py-2 rounded cursor-pointer" style={{ fontFamily: `"${font.family}", sans-serif` }}>{font.family}</div>
                      ))}
                    </div>
                  )}
                </div>
                <label className="flex items-center justify-center gap-2 w-full bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 text-xs py-2 px-3 rounded-lg cursor-pointer">
                  <Upload className="w-4 h-4" /> Upload Custom Font (.ttf)
                  <input type="file" accept=".ttf,.otf,.woff,.woff2" className="hidden" onChange={handleFontUpload} />
                </label>
                {!dragMode && (
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Position</label>
                    <select value={textStyle.position} onChange={(e) => setTextStyle({ ...textStyle, position: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-indigo-500">
                      <option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option>
                    </select>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-400 uppercase flex justify-between"><span>Font Size</span><span className="text-indigo-400">{textStyle.fontSize}px</span></label>
                  <input type="range" min="30" max="120" value={textStyle.fontSize} onChange={(e) => setTextStyle({ ...textStyle, fontSize: parseInt(e.target.value) })} className="w-full accent-indigo-500" />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Text Color</label>
                  <div className="flex gap-2">
                    <input type="color" value={textStyle.color} onChange={(e) => setTextStyle({ ...textStyle, color: e.target.value })} className="w-10 h-10 rounded cursor-pointer bg-slate-950 border border-slate-700" />
                    <div className="flex-1 grid grid-cols-5 gap-1">
                      {['#ffffff', '#fcd34d', '#f87171', '#60a5fa', '#34d399'].map(c => (
                        <button key={c} onClick={() => setTextStyle({ ...textStyle, color: c })} className="w-full h-10 rounded-md border border-slate-700" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </div>
                </div>
                <label className="flex items-center gap-3 p-3 bg-slate-950 rounded-lg border border-slate-800 cursor-pointer">
                  <input type="checkbox" checked={textStyle.shadow} onChange={(e) => setTextStyle({ ...textStyle, shadow: e.target.checked })} className="w-4 h-4 rounded text-indigo-500" />
                  <span className="text-sm font-medium">Text Drop Shadow</span>
                </label>
              </div>
            )}

            {/* OVERLAYS TAB (NEW) */}
            {activeTab === 'overlays' && (
              <div className="space-y-4">
                <p className="text-xs text-slate-400">Add logos, watermarks, or fixed titles. Drag them on the canvas to position.</p>
                <div className="flex gap-2">
                  <button onClick={addTextOverlay} className="flex-1 bg-indigo-600/20 text-indigo-400 py-2 rounded text-xs font-semibold hover:bg-indigo-600/30">+ Add Text</button>
                  <label className="flex-1 bg-indigo-600/20 text-indigo-400 py-2 rounded text-center text-xs font-semibold cursor-pointer hover:bg-indigo-600/30">
                    + Add Logo <input type="file" accept="image/*" className="hidden" onChange={addImageOverlay} />
                  </label>
                </div>
                <div className="space-y-2 mt-4">
                  {overlays.map(ov => (
                    <div key={ov.id} className={`p-3 rounded bg-slate-950 border ${activeOverlayId === ov.id ? 'border-indigo-500' : 'border-slate-800'}`} onClick={() => setActiveOverlayId(ov.id)}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-xs font-bold">{ov.type === 'image' ? 'Image' : 'Text'}</span>
                        <Trash2 className="w-4 h-4 text-rose-400 cursor-pointer" onClick={(e) => { e.stopPropagation(); setOverlays(p => p.filter(o => o.id !== ov.id)); setActiveOverlayId(null); }} />
                      </div>
                      {ov.type === 'text' && (
                        <>
                          <input type="text" value={ov.text} onChange={e => setOverlays(p => p.map(o => o.id === ov.id ? { ...o, text: e.target.value } : o))} className="w-full bg-slate-900 rounded p-1 text-sm text-white mb-2 border border-slate-700" />
                          <div className="flex gap-2 items-center mb-2">
                            <label className="text-xs text-slate-500">Text</label>
                            <input type="color" value={ov.color} onChange={e => setOverlays(p => p.map(o => o.id === ov.id ? { ...o, color: e.target.value } : o))} className="w-6 h-6 rounded cursor-pointer" />
                            <label className="text-xs text-slate-500 ml-2">BG</label>
                            <input type="color" value={ov.bgColor === 'transparent' ? '#000000' : ov.bgColor} onChange={e => setOverlays(p => p.map(o => o.id === ov.id ? { ...o, bgColor: e.target.value } : o))} className="w-6 h-6 rounded cursor-pointer" />
                            <button onClick={() => setOverlays(p => p.map(o => o.id === ov.id ? { ...o, bgColor: 'transparent' } : o))} className="text-[10px] text-rose-400 ml-1 hover:underline">Clear BG</button>
                          </div>
                        </>
                      )}
                      <label className="text-xs text-slate-500">Scale ({(ov.scale).toFixed(1)}x)</label>
                      <input type="range" min="0.1" max="3" step="0.1" value={ov.scale} onChange={e => setOverlays(p => p.map(o => o.id === ov.id ? { ...o, scale: parseFloat(e.target.value) } : o))} className="w-full accent-indigo-500" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Panel - Preview & Playback */}
        <div className="flex-1 flex flex-col bg-black relative">
          <div className="flex-1 flex items-center justify-center p-4 relative overflow-hidden bg-slate-950">
            <div className={`relative bg-slate-900 rounded-lg overflow-hidden shadow-2xl ring-1 ring-slate-800 transition-all duration-300 ease-in-out ${aspectRatio === '16:9' ? 'w-full max-w-[1280px] aspect-video' : 'h-full max-h-[1280px] aspect-[9/16]'}`}>
              <canvas ref={canvasRef} width={canvasWidth} height={canvasHeight} className="w-full h-full object-contain cursor-move"
                onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} />
              {!isPlaying && !isRecording && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 cursor-pointer group" onClick={togglePlay}>
                  <div className="w-20 h-20 rounded-full bg-indigo-600/90 text-white flex items-center justify-center shadow-xl shadow-indigo-900/50 group-hover:scale-105 transition-all">
                    <Play className="w-10 h-10 ml-1" />
                  </div>
                </div>
              )}
              {isRecording && (
                <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/70 px-3 py-1.5 rounded-full text-xs font-bold text-rose-500 shadow-lg backdrop-blur-sm z-50">
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" /> REC
                </div>
              )}
            </div>
          </div>
          <div className="bg-slate-950 border-t border-slate-800 p-4">
            <div className="max-w-5xl mx-auto flex flex-col gap-3">
              <div className="flex items-center gap-4 text-xs font-medium font-mono text-slate-400">
                <span>{formatTime(currentTime)}</span>
                <div className="flex-1 relative h-3 group cursor-pointer" onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); handleSeek((e.clientX - rect.left) / rect.width); }}>
                  <div className="absolute inset-y-1 inset-x-0 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 relative transition-all duration-75" style={{ width: `${(currentTime / totalDuration) * 100}%` }}>
                      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 bg-white rounded-full shadow" />
                    </div>
                  </div>
                </div>
                <span>{formatTime(totalDuration)}</span>
              </div>
              <div className="flex items-center justify-center gap-4">
                <button onClick={() => handleSeek(0)} disabled={isRecording} className="p-2 text-slate-400 hover:text-white disabled:opacity-50" title="Reset"><Square className="w-5 h-5" /></button>
                <button onClick={togglePlay} disabled={isRecording} className="w-12 h-12 flex items-center justify-center rounded-full bg-white text-slate-900 hover:bg-indigo-100 shadow-lg disabled:opacity-50">
                  {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-1" />}
                </button>
                <button disabled className="p-2 text-slate-600" title="Full Screen Preview"><MonitorPlay className="w-5 h-5" /></button>
              </div>
            </div>
          </div>
        </div>
      </main>

      <style dangerouslySetInnerHTML={{
        __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background-color: #334155; border-radius: 20px; }
      `}} />
    </div>
  );
}
