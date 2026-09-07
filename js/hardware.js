// Hardware fingerprinting for browser
var HardwareFingerprint = (function() {
    'use strict';

    function getBrowserInfo() {
        var nav = navigator || {};
        var screen = window.screen || {};
        var info = {
            user_agent: nav.userAgent || '',
            platform: nav.platform || '',
            language: nav.language || '',
            languages: Array.isArray(nav.languages) ? nav.languages.join(',') : '',
            hardware_concurrency: nav.hardwareConcurrency || null,
            device_memory: nav.deviceMemory || null,
            max_touch_points: nav.maxTouchPoints || 0,
            screen_width: screen.width || null,
            screen_height: screen.height || null,
            color_depth: screen.colorDepth || null,
            pixel_depth: screen.pixelDepth || null,
            timezone_offset: new Date().getTimezoneOffset(),
            timezone: Intl ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
            do_not_track: nav.doNotTrack || null,
            cookie_enabled: nav.cookieEnabled || false,
        };
        return info;
    }

    function getCanvasFingerprint() {
        try {
            var canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 50;
            var ctx = canvas.getContext('2d');
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('UCHIHA HWID', 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
            ctx.fillText('UCHIHA HWID', 4, 17);
            return canvas.toDataURL().slice(0, 100);
        } catch (e) {
            return null;
        }
    }

    function getWebGLInfo() {
        try {
            var canvas = document.createElement('canvas');
            var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            if (!gl) return null;
            var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            if (!debugInfo) return null;
            return {
                vendor: gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
                renderer: gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL),
            };
        } catch (e) {
            return null;
        }
    }

    function getAudioFingerprint() {
        try {
            var AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return null;
            var ctx = new AudioContext();
            var oscillator = ctx.createOscillator();
            var analyser = ctx.createAnalyser();
            var gain = ctx.createGain();
            var scriptProcessor = ctx.createScriptProcessor(4096, 1, 1);
            oscillator.type = 'triangle';
            oscillator.frequency.value = 10000;
            gain.gain.value = 0;
            oscillator.connect(analyser);
            analyser.connect(scriptProcessor);
            scriptProcessor.connect(gain);
            gain.connect(ctx.destination);
            oscillator.start(0);
            var fingerprint = '';
            scriptProcessor.onaudioprocess = function(e) {
                var data = new Float32Array(e.inputBuffer.getChannelData(0));
                var sum = 0;
                for (var i = 0; i < data.length; i++) {
                    sum += Math.abs(data[i]);
                }
                fingerprint = String(sum);
                oscillator.stop();
                ctx.close();
            };
            return fingerprint || null;
        } catch (e) {
            return null;
        }
    }

    function collect() {
        var browserInfo = getBrowserInfo();
        var canvas = getCanvasFingerprint();
        var webgl = getWebGLInfo();
        var audio = getAudioFingerprint();

        var data = {
            os_info: browserInfo.platform + ' | ' + browserInfo.user_agent.slice(0, 100),
            os_username: 'browser',
            cpu_id: String(browserInfo.hardware_concurrency || 'unknown') + ' cores',
            ram_total: browserInfo.device_memory ? (browserInfo.device_memory * 1024) : null,
            gpu_ids: webgl ? [webgl.renderer] : [],
            mac_addresses: [],
            storage_ids: [],
            motherboard_id: null,
            browser_fingerprint: null,
            browser_info: browserInfo,
            canvas_fingerprint: canvas,
            webgl_info: webgl,
            audio_fingerprint: audio,
        };

        var fpStr = JSON.stringify({
            ua: data.os_info,
            cpu: data.cpu_id,
            ram: data.ram_total,
            gpu: data.gpu_ids,
            screen: browserInfo.screen_width + 'x' + browserInfo.screen_height,
            timezone: browserInfo.timezone,
            lang: browserInfo.language,
        });
        data.browser_fingerprint = simpleHash(fpStr);

        return data;
    }

    function simpleHash(str) {
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            var char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(16);
    }

    return {
        collect: collect,
        getBrowserInfo: getBrowserInfo,
        getCanvasFingerprint: getCanvasFingerprint,
        getWebGLInfo: getWebGLInfo,
        getAudioFingerprint: getAudioFingerprint,
    };
})();
