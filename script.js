// ===== CONFIGURATION =====
const CONFIG = {
    // Stream configuration - set to empty string to hide live functionality
    STREAM_URL: '', // 'https://example.com/radio-adamowo/stream.m3u8'
    FALLBACK_URL: '',
    
    // Cache configuration
    CACHE_NAME: 'radio-adamowo-v2',
    
    // Audio settings
    VISUALIZER_FFT_SIZE: 256,
    CROSSFADE_DURATION: 300,
    
    // UI settings
    SCROLL_THRESHOLD: 300,
    ANIMATION_SPEED_MULTIPLIER: 1,
    
    // Keyboard shortcuts
    SHORTCUTS: {
        PLAY_PAUSE: ' ', // Space
        NEXT: 'ArrowRight',
        PREV: 'ArrowLeft',
        MUTE: 'm',
        SHUFFLE: 's',
        HOME: 'Home'
    }
};

// ===== GLOBAL STATE =====
const AppState = {
    // Audio
    audioContext: null,
    audioSource: null,
    analyser: null,
    gainNode: null,
    isAudioInitialized: false,
    isPlaying: false,
    isMuted: false,
    currentVolume: 1,
    
    // Playlist
    playlists: {
        ambient: [],
        disco: [],
        hiphop: [],
        barbara: [],
        kids: [],
        full: [],
        podcasts: []
    },
    currentPlaylist: [],
    currentTrackIndex: 0,
    isShuffled: false,
    
    // UI
    animationId: null,
    isModalOpen: false,
    
    // PWA
    deferredPrompt: null,
    
    // HLS
    hls: null,
    isLiveMode: false
};

// ===== UTILITY FUNCTIONS =====
const Utils = {
    // DOM helpers
    $(selector) {
        return document.querySelector(selector);
    },
    
    $$(selector) {
        return document.querySelectorAll(selector);
    },
    
    // Debounce function
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    },
    
    // Generate safe ID from filename
    generateId(filepath) {
        if (!filepath || typeof filepath !== 'string') return 'track';
        const filename = filepath.split('/').pop();
        return filename.replace(/\.mp3$/i, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    },
    
    // Generate human-readable title
    generateTitle(filepath) {
        if (!filepath || typeof filepath !== 'string') return 'Utwór bez tytułu';
        
        const filename = filepath.split('/').pop();
        if (!filename) return 'Utwór bez tytułu';
        
        let title = filename.replace(/\.mp3$/i, '');
        title = title.replace(/Utwor\s*\((\d+)\)/i, 'Utwór $1');
        title = title.replace(/_/g, ' ');
        title = title.replace(/\b\w/g, l => l.toUpperCase());
        
        return title || 'Utwór bez tytułu';
    },
    
    // Shuffle array in place
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    },
    
    // Show toast notification
    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            background: ${type === 'error' ? '#dc2626' : type === 'success' ? '#10b981' : '#f59e0b'};
            color: white;
            border-radius: 8px;
            z-index: 10000;
            animation: slideInRight 0.3s ease-out;
        `;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'slideOutRight 0.3s ease-in forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },
    
    // Format time
    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    },
    
    // Check if user prefers reduced motion
    prefersReducedMotion() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
};

// ===== INFINITY SYMBOL CONTROLLER =====
const InfinityController = {
    init() {
        const symbol = Utils.$('.infinity-symbol');
        if (!symbol) return;
        
        // Apply static class if reduced motion is preferred
        if (Utils.prefersReducedMotion()) {
            symbol.classList.add('infinity--static');
        }
        
        // Set initial speed
        this.setSpeed(CONFIG.ANIMATION_SPEED_MULTIPLIER);
    },
    
    setSpeed(multiplier) {
        const marker = Utils.$('#infinityMarker animateMotion');
        if (marker) {
            const baseDuration = 8; // seconds
            const newDuration = baseDuration / multiplier;
            marker.setAttribute('dur', `${newDuration}s`);
        }
    }
};

// ===== PWA MANAGER =====
const PWAManager = {
    init() {
        this.setupInstallPrompt();
        this.registerServiceWorker();
    },
    
    setupInstallPrompt() {
        const banner = Utils.$('#pwa-install-banner');
        const installBtn = Utils.$('#pwa-install-btn');
        const closeBtn = Utils.$('#pwa-close-btn');
        
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            AppState.deferredPrompt = e;
            if (banner) banner.classList.remove('hidden');
        });
        
        if (installBtn) {
            installBtn.addEventListener('click', async () => {
                if (AppState.deferredPrompt) {
                    AppState.deferredPrompt.prompt();
                    const { outcome } = await AppState.deferredPrompt.userChoice;
                    if (outcome === 'accepted' && banner) {
                        banner.classList.add('hidden');
                    }
                    AppState.deferredPrompt = null;
                }
            });
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                if (banner) banner.classList.add('hidden');
            });
        }
        
        // Hide banner after app is installed
        window.addEventListener('appinstalled', () => {
            if (banner) banner.classList.add('hidden');
        });
    },
    
    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js')
                    .then(reg => console.log('Service Worker registered:', reg.scope))
                    .catch(err => console.error('Service Worker registration failed:', err));
            });
        }
    }
};

// ===== PLAYLIST MANAGER =====
const PlaylistManager = {
    async init() {
        await this.loadPlaylist();
        this.setupPlaylistControls();
    },
    
    async loadPlaylist() {
        try {
            const response = await fetch('playlist.json');
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            
            const playlistData = await response.json();
            this.processPlaylistData(playlistData);
            
            console.log('Playlist loaded:', {
                ambient: AppState.playlists.ambient.length,
                disco: AppState.playlists.disco.length,
                hiphop: AppState.playlists.hiphop.length,
                barbara: AppState.playlists.barbara.length,
                kids: AppState.playlists.kids.length,
                full: AppState.playlists.full.length,
                podcasts: AppState.playlists.podcasts.length
            });
            
        } catch (error) {
            console.error('Failed to load playlist:', error);
            Utils.showToast('Nie udało się załadować playlisty', 'error');
            this.initializeFallbackPlaylists();
        }
    },
    
    processPlaylistData(data) {
        // Clear existing playlists
        Object.keys(AppState.playlists).forEach(key => {
            AppState.playlists[key] = [];
        });
        
        data.forEach(item => {
            const track = {
                title: Utils.generateTitle(item.file),
                artist: "Radio Adamowo",
                url: item.file,
                category: item.category
            };
            
            // Add to category playlist
            if (AppState.playlists[item.category]) {
                AppState.playlists[item.category].push(track);
            }
            
            // Add to full playlist
            AppState.playlists.full.push(track);
            
            // Create podcasts from audio category
            if (item.category === 'audio') {
                const podcastTrack = {
                    id: Utils.generateId(item.file),
                    title: Utils.generateTitle(item.file),
                    url: item.file,
                    description: this.generatePodcastDescription(item.file)
                };
                AppState.playlists.podcasts.push(podcastTrack);
            }
        });
        
        // Generate podcast UI
        this.generatePodcastUI();
    },
    
    generatePodcastDescription(filename) {
        const descriptions = {
            'Adamskich_Sprawa': 'Zarys historii, która stała się naszym studium przypadku.',
            'Rażąca_Niewdzięczność': 'Jak termin prawny staje się narzędziem gaslightingu.',
            'kalendarz_analiza': 'Śledzimy, jak drobne incydenty budują mur przemocy.',
            'sledztwo': 'Praktyczny poradnik, jak zbierać dowody i chronić się.',
            'analiza': 'Dogłębna analiza mechanizmów manipulacji psychologicznej.',
            'domek': 'Historia o tym, jak dom staje się więzieniem.',
            'Dramat_Rodziny': 'Anatomia rodzinnego konfliktu i jego konsekwencji.',
            'Konflikt_rodzinny': 'Eskalacja napięć w toksycznej rodzinie.',
            'rekonstrukcja': 'Odtworzenie wydarzeń na podstawie dokumentów.',
            'szept': 'Ukryte nagranie ujawniające prawdę za fasadą.'
        };
        
        const key = Object.keys(descriptions).find(k => filename.includes(k));
        return descriptions[key] || 'Audycja analityczna o manipulacji psychologicznej.';
    },
    
    generatePodcastUI() {
        const container = Utils.$('.podcast-grid');
        if (!container) return;
        
        container.innerHTML = '';
        
        AppState.playlists.podcasts.forEach(podcast => {
            const item = document.createElement('article');
            item.className = 'podcast-item';
            item.innerHTML = `
                <h4 class="podcast-item-title">${podcast.title}</h4>
                <p class="podcast-item-description">${podcast.description}</p>
                <button class="podcast-play-btn" data-track-id="${podcast.id}" aria-label="Odtwórz ${podcast.title}">
                    Odsłuchaj
                </button>
            `;
            container.appendChild(item);
        });
        
        // Attach event listeners
        Utils.$$('.podcast-play-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.playPodcast(btn.dataset.trackId);
            });
        });
    },
    
    initializeFallbackPlaylists() {
        // Fallback data for demo purposes
        AppState.playlists.ambient = [
            { title: "Ambient Soundscape #1", artist: "Radio Adamowo", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
            { title: "Dark Atmosphere #2", artist: "Radio Adamowo", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" }
        ];
        
        AppState.playlists.full = [...AppState.playlists.ambient];
        
        AppState.playlists.podcasts = [
            { id: 'demo1', title: "Demo Podcast 1", url: 'audio/demo1.mp3', description: 'Przykładowy podcast demonstracyjny.' }
        ];
        
        this.generatePodcastUI();
    },
    
    setupPlaylistControls() {
        Utils.$$('.playlist-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setPlaylist(btn.dataset.playlist);
            });
        });
    },
    
    setPlaylist(playlistKey) {
        const playlist = AppState.playlists[playlistKey];
        if (!playlist || playlist.length === 0) {
            Utils.showToast('Playlista jest pusta', 'error');
            return;
        }
        
        AppState.currentPlaylist = [...playlist];
        AppState.currentTrackIndex = 0;
        
        if (AppState.isShuffled) {
            Utils.shuffleArray(AppState.currentPlaylist);
        }
        
        // Update UI
        this.updatePlaylistUI(playlistKey);
        this.updateTrackInfo();
        
        // Enable controls
        AudioPlayer.enableControls();
        
        Utils.showToast(`Wybrano playlistę: ${playlistKey} (${AppState.currentPlaylist.length} utworów)`, 'success');
    },
    
    updatePlaylistUI(activePlaylist) {
        Utils.$$('.playlist-btn').forEach(btn => {
            btn.setAttribute('aria-selected', 'false');
        });
        
        const activeBtn = Utils.$(`[data-playlist="${activePlaylist}"]`);
        if (activeBtn) {
            activeBtn.setAttribute('aria-selected', 'true');
        }
    },
    
    playPodcast(trackId) {
        if (!AppState.isAudioInitialized) return;
        
        const podcast = AppState.playlists.podcasts.find(p => p.id === trackId);
        if (!podcast) return;
        
        const podcastPlayer = Utils.$('#podcast-player');
        const podcastTitle = Utils.$('#podcast-title');
        
        if (podcastPlayer) {
            // Pause main player
            AudioPlayer.pause();
            
            podcastPlayer.src = podcast.url;
            if (podcastTitle) podcastTitle.textContent = podcast.title;
            
            podcastPlayer.play().catch(e => {
                console.error('Podcast playback error:', e);
                Utils.showToast('Nie udało się odtworzyć podcastu', 'error');
            });
        }
    },
    
    updateTrackInfo() {
        const trackInfo = Utils.$('#current-track');
        if (!trackInfo) return;
        
        if (AppState.currentPlaylist.length === 0) {
            trackInfo.textContent = 'Wybierz playlistę...';
            return;
        }
        
        const track = AppState.currentPlaylist[AppState.currentTrackIndex];
        if (track) {
            trackInfo.textContent = `${track.title} - ${track.artist}`;
        }
    }
};

// ===== AUDIO PLAYER =====
const AudioPlayer = {
    async init() {
        this.setupEventListeners();
        this.checkLiveStreamAvailability();
    },
    
    checkLiveStreamAvailability() {
        const liveContainer = Utils.$('#live-toggle-container');
        if (CONFIG.STREAM_URL && CONFIG.STREAM_URL.trim()) {
            if (liveContainer) liveContainer.classList.remove('hidden');
            this.setupLiveToggle();
        } else {
            if (liveContainer) liveContainer.classList.add('hidden');
        }
    },
    
    setupLiveToggle() {
        const liveToggle = Utils.$('#live-toggle');
        if (!liveToggle) return;
        
        liveToggle.addEventListener('click', () => {
            const isPressed = liveToggle.getAttribute('aria-pressed') === 'true';
            this.toggleLiveMode(!isPressed);
        });
    },
    
    toggleLiveMode(enable) {
        const liveToggle = Utils.$('#live-toggle');
        if (!liveToggle) return;
        
        AppState.isLiveMode = enable;
        liveToggle.setAttribute('aria-pressed', enable.toString());
        
        if (enable) {
            this.initializeHLS();
            Utils.showToast('Przełączono na transmisję na żywo', 'success');
        } else {
            this.destroyHLS();
            Utils.showToast('Przełączono na playlistę', 'success');
        }
    },
    
    async initializeAudio() {
        if (AppState.isAudioInitialized) return;
        
        try {
            AppState.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            
            if (AppState.audioContext.state === 'suspended') {
                await AppState.audioContext.resume();
            }
            
            AppState.analyser = AppState.audioContext.createAnalyser();
            AppState.analyser.fftSize = CONFIG.VISUALIZER_FFT_SIZE;
            
            AppState.gainNode = AppState.audioContext.createGain();
            AppState.gainNode.gain.value = AppState.currentVolume;
            
            const audioElement = Utils.$('#radio-player');
            if (audioElement) {
                AppState.audioSource = AppState.audioContext.createMediaElementSource(audioElement);
                AppState.audioSource
                    .connect(AppState.gainNode)
                    .connect(AppState.analyser)
                    .connect(AppState.audioContext.destination);
            }
            
            AppState.isAudioInitialized = true;
            console.log('Web Audio API initialized successfully');
            
            this.enableControls();
            Visualizer.init();
            
            Utils.showToast('Audio zainicjalizowane pomyślnie', 'success');
            
        } catch (error) {
            console.error('Could not initialize Web Audio API:', error);
            Utils.showToast('Błąd inicjalizacji audio', 'error');
        }
    },
    
    initializeHLS() {
        if (!CONFIG.STREAM_URL) return;
        
        const audioElement = Utils.$('#radio-player');
        if (!audioElement) return;
        
        // Clean up existing HLS
        this.destroyHLS();
        
        if (window.Hls && window.Hls.isSupported()) {
            AppState.hls = new window.Hls({
                enableWorker: true,
                lowLatencyMode: true,
                backBufferLength: 90
            });
            
            AppState.hls.loadSource(CONFIG.STREAM_URL);
            AppState.hls.attachMedia(audioElement);
            
            AppState.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
                console.log('HLS manifest loaded, found ' + AppState.hls.levels.length + ' quality level(s)');
            });
            
            AppState.hls.on(window.Hls.Events.ERROR, (event, data) => {
                console.error('HLS error:', data);
                if (data.fatal) {
                    this.handleHLSError(data);
                }
            });
            
        } else if (audioElement.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari native HLS support
            audioElement.src = CONFIG.STREAM_URL;
            console.log('Using native HLS support (Safari)');
        } else {
            console.warn('HLS not supported, falling back to regular audio');
            Utils.showToast('HLS nie jest obsługiwane', 'error');
            this.toggleLiveMode(false);
        }
    },
    
    handleHLSError(data) {
        switch(data.type) {
            case window.Hls.ErrorTypes.NETWORK_ERROR:
                console.log('Fatal network error, trying to recover');
                AppState.hls.startLoad();
                break;
            case window.Hls.ErrorTypes.MEDIA_ERROR:
                console.log('Fatal media error, trying to recover');
                AppState.hls.recoverMediaError();
                break;
            default:
                console.log('Fatal error, cannot recover');
                this.destroyHLS();
                this.toggleLiveMode(false);
                if (CONFIG.FALLBACK_URL) {
                    Utils.$('#radio-player').src = CONFIG.FALLBACK_URL;
                    Utils.showToast('Przełączono na stream zapasowy', 'info');
                } else {
                    Utils.showToast('Błąd transmisji na żywo', 'error');
                }
                break;
        }
    },
    
    destroyHLS() {
        if (AppState.hls) {
            AppState.hls.destroy();
            AppState.hls = null;
        }
    },
    
    setupEventListeners() {
        const audioElement = Utils.$('#radio-player');
        if (!audioElement) return;
        
        audioElement.addEventListener('play', () => {
            AppState.isPlaying = true;
            this.updatePlayButton();
            MediaSessionManager.updatePlaybackState('playing');
        });
        
        audioElement.addEventListener('pause', () => {
            AppState.isPlaying = false;
            this.updatePlayButton();
            MediaSessionManager.updatePlaybackState('paused');
        });
        
        audioElement.addEventListener('ended', () => {
            if (!AppState.isLiveMode) {
                this.next();
            }
        });
        
        audioElement.addEventListener('timeupdate', () => {
            this.updateProgress();
        });
        
        audioElement.addEventListener('error', (e) => {
            console.error('Audio error:', e);
            this.handleAudioError();
        });
        
        // Control buttons
        const playPauseBtn = Utils.$('#play-pause-btn');
        const nextBtn = Utils.$('#next-btn');
        const prevBtn = Utils.$('#prev-btn');
        const shuffleBtn = Utils.$('#shuffle-btn');
        const muteBtn = Utils.$('#mute-btn');
        
        if (playPauseBtn) playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        if (nextBtn) nextBtn.addEventListener('click', () => this.next());
        if (prevBtn) prevBtn.addEventListener('click', () => this.prev());
        if (shuffleBtn) shuffleBtn.addEventListener('click', () => this.toggleShuffle());
        if (muteBtn) muteBtn.addEventListener('click', () => this.toggleMute());
    },
    
    enableControls() {
        Utils.$$('#play-pause-btn, #next-btn, #prev-btn, #shuffle-btn, #mute-btn').forEach(btn => {
            if (btn) btn.disabled = false;
        });
    },
    
    async togglePlayPause() {
        if (!AppState.isAudioInitialized) return;
        
        const audioElement = Utils.$('#radio-player');
        if (!audioElement) return;
        
        if (AppState.audioContext && AppState.audioContext.state === 'suspended') {
            await AppState.audioContext.resume();
        }
        
        try {
            if (AppState.isPlaying) {
                audioElement.pause();
            } else {
                if (AppState.isLiveMode) {
                    // For live streams, just play
                    await audioElement.play();
                } else {
                    // For playlists, load current track if needed
                    if (!audioElement.src || audioElement.src !== this.getCurrentTrack()?.url) {
                        this.loadCurrentTrack();
                    }
                    await audioElement.play();
                }
            }
        } catch (error) {
            console.error('Playback error:', error);
            Utils.showToast('Błąd odtwarzania', 'error');
        }
    },
    
    next() {
        if (AppState.isLiveMode || AppState.currentPlaylist.length === 0) return;
        
        AppState.currentTrackIndex = (AppState.currentTrackIndex + 1) % AppState.currentPlaylist.length;
        this.loadCurrentTrack();
        PlaylistManager.updateTrackInfo();
        
        if (AppState.isPlaying) {
            this.play();
        }
    },
    
    prev() {
        if (AppState.isLiveMode || AppState.currentPlaylist.length === 0) return;
        
        AppState.currentTrackIndex = (AppState.currentTrackIndex - 1 + AppState.currentPlaylist.length) % AppState.currentPlaylist.length;
        this.loadCurrentTrack();
        PlaylistManager.updateTrackInfo();
        
        if (AppState.isPlaying) {
            this.play();
        }
    },
    
    toggleShuffle() {
        AppState.isShuffled = !AppState.isShuffled;
        
        const shuffleBtn = Utils.$('#shuffle-btn');
        if (shuffleBtn) {
            shuffleBtn.style.opacity = AppState.isShuffled ? '1' : '0.6';
            shuffleBtn.setAttribute('aria-pressed', AppState.isShuffled.toString());
        }
        
        if (AppState.isShuffled && AppState.currentPlaylist.length > 0) {
            const currentTrack = AppState.currentPlaylist[AppState.currentTrackIndex];
            Utils.shuffleArray(AppState.currentPlaylist);
            AppState.currentTrackIndex = AppState.currentPlaylist.findIndex(track => track === currentTrack);
        }
        
        Utils.showToast(AppState.isShuffled ? 'Shuffle włączony' : 'Shuffle wyłączony', 'info');
    },
    
    toggleMute() {
        AppState.isMuted = !AppState.isMuted;
        
        const audioElement = Utils.$('#radio-player');
        const muteBtn = Utils.$('#mute-btn');
        
        if (audioElement) {
            audioElement.muted = AppState.isMuted;
        }
        
        if (AppState.gainNode) {
            AppState.gainNode.gain.value = AppState.isMuted ? 0 : AppState.currentVolume;
        }
        
        if (muteBtn) {
            muteBtn.textContent = AppState.isMuted ? '🔇' : '🔊';
            muteBtn.setAttribute('aria-label', AppState.isMuted ? 'Włącz dźwięk' : 'Wycisz');
        }
    },
    
    getCurrentTrack() {
        if (AppState.currentPlaylist.length === 0) return null;
        return AppState.currentPlaylist[AppState.currentTrackIndex];
    },
    
    loadCurrentTrack() {
        const track = this.getCurrentTrack();
        if (!track) return;
        
        const audioElement = Utils.$('#radio-player');
        if (audioElement) {
            // Clean up HLS if switching to regular audio
            if (AppState.hls && !track.url.includes('.m3u8')) {
                this.destroyHLS();
            }
            
            audioElement.src = track.url;
            MediaSessionManager.updateMetadata(track.title, track.artist);
        }
    },
    
    async play() {
        const audioElement = Utils.$('#radio-player');
        if (audioElement) {
            try {
                await audioElement.play();
            } catch (error) {
                console.error('Play error:', error);
                this.handleAudioError();
            }
        }
    },
    
    pause() {
        const audioElement = Utils.$('#radio-player');
        if (audioElement) {
            audioElement.pause();
        }
    },
    
    updatePlayButton() {
        const playIcon = Utils.$('#play-icon');
        const pauseIcon = Utils.$('#pause-icon');
        
        if (AppState.isPlaying) {
            if (playIcon) playIcon.classList.add('hidden');
            if (pauseIcon) pauseIcon.classList.remove('hidden');
        } else {
            if (playIcon) playIcon.classList.remove('hidden');
            if (pauseIcon) pauseIcon.classList.add('hidden');
        }
    },
    
    updateProgress() {
        const audioElement = Utils.$('#radio-player');
        const progressBar = Utils.$('.progress-bar');
        
        if (audioElement && progressBar && !AppState.isLiveMode) {
            const progress = (audioElement.currentTime / audioElement.duration) * 100;
            progressBar.style.width = `${progress || 0}%`;
            
            const progressContainer = Utils.$('#track-progress');
            if (progressContainer) {
                progressContainer.setAttribute('aria-valuenow', Math.round(progress || 0));
            }
        }
    },
    
    handleAudioError() {
        Utils.showToast('Błąd odtwarzania utworu', 'error');
        
        // Try to skip to next track if in playlist mode
        if (!AppState.isLiveMode && AppState.currentPlaylist.length > 1) {
            setTimeout(() => this.next(), 1000);
        }
    }
};

// ===== MEDIA SESSION MANAGER =====
const MediaSessionManager = {
    init() {
        if (!('mediaSession' in navigator)) return;
        
        this.setupActionHandlers();
    },
    
    updateMetadata(title, artist = 'Radio Adamowo', album = 'Radio Adamowo') {
        if (!('mediaSession' in navigator)) return;
        
        navigator.mediaSession.metadata = new MediaMetadata({
            title,
            artist,
            album,
            artwork: [
                { src: 'public/images/studio/studio-1.png', sizes: '96x96', type: 'image/png' },
                { src: 'public/images/studio/studio-1.png', sizes: '128x128', type: 'image/png' },
                { src: 'public/images/studio/studio-1.png', sizes: '192x192', type: 'image/png' },
                { src: 'public/images/studio/studio-1.png', sizes: '256x256', type: 'image/png' },
                { src: 'public/images/studio/studio-1.png', sizes: '384x384', type: 'image/png' },
                { src: 'public/images/studio/studio-1.png', sizes: '512x512', type: 'image/png' }
            ]
        });
    },
    
    updatePlaybackState(state) {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.playbackState = state;
    },
    
    setupActionHandlers() {
        const actions = [
            ['play', () => AudioPlayer.togglePlayPause()],
            ['pause', () => AudioPlayer.togglePlayPause()],
            ['previoustrack', () => AudioPlayer.prev()],
            ['nexttrack', () => AudioPlayer.next()],
            ['stop', () => AudioPlayer.pause()]
        ];
        
        actions.forEach(([action, handler]) => {
            try {
                navigator.mediaSession.setActionHandler(action, handler);
            } catch (error) {
                console.warn(`The media session action "${action}" is not supported.`);
            }
        });
    }
};

// ===== VISUALIZER =====
const Visualizer = {
    init() {
        if (Utils.prefersReducedMotion()) return;
        
        this.canvas = Utils.$('#visualizer-canvas');
        if (!this.canvas) return;
        
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        this.animate();
        
        window.addEventListener('resize', Utils.debounce(() => this.resize(), 250));
    },
    
    resize() {
        if (!this.canvas) return;
        
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
    },
    
    animate() {
        if (!AppState.analyser || !AppState.isPlaying) {
            AppState.animationId = requestAnimationFrame(() => this.animate());
            return;
        }
        
        const bufferLength = AppState.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        AppState.analyser.getByteFrequencyData(dataArray);
        
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        
        const barWidth = (this.canvas.width / bufferLength) * 2.5;
        let x = 0;
        
        for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * this.canvas.height / 2;
            
            const r = barHeight + 25 * (i / bufferLength);
            const g = 250 * (i / bufferLength);
            const b = 50;
            
            this.ctx.fillStyle = `rgb(${r},${g},${b})`;
            this.ctx.fillRect(x, this.canvas.height - barHeight, barWidth, barHeight);
            
            x += barWidth + 1;
        }
        
        AppState.animationId = requestAnimationFrame(() => this.animate());
    }
};

// ===== KEYBOARD SHORTCUTS =====
const KeyboardManager = {
    init() {
        document.addEventListener('keydown', (e) => this.handleKeydown(e));
    },
    
    handleKeydown(e) {
        // Don't handle shortcuts when modal is open or user is typing
        if (AppState.isModalOpen || this.isTyping(e.target)) return;
        
        const { SHORTCUTS } = CONFIG;
        
        switch (e.key) {
            case SHORTCUTS.PLAY_PAUSE:
                e.preventDefault();
                AudioPlayer.togglePlayPause();
                break;
            case SHORTCUTS.NEXT:
                e.preventDefault();
                AudioPlayer.next();
                break;
            case SHORTCUTS.PREV:
                e.preventDefault();
                AudioPlayer.prev();
                break;
            case SHORTCUTS.MUTE:
                if (e.ctrlKey || e.metaKey) return; // Don't interfere with browser shortcuts
                e.preventDefault();
                AudioPlayer.toggleMute();
                break;
            case SHORTCUTS.SHUFFLE:
                if (e.ctrlKey || e.metaKey) return;
                e.preventDefault();
                AudioPlayer.toggleShuffle();
                break;
            case SHORTCUTS.HOME:
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: 'smooth' });
                break;
            case 'Escape':
                if (AppState.isModalOpen) {
                    NotesManager.closeModal();
                }
                break;
        }
    },
    
    isTyping(element) {
        const typingElements = ['INPUT', 'TEXTAREA', 'SELECT'];
        return typingElements.includes(element.tagName) || element.contentEditable === 'true';
    }
};

// ===== NOTES MANAGER =====
const NotesManager = {
    init() {
        this.setupCalendar();
        this.setupModal();
    },
    
    setupCalendar() {
        this.generateCalendar();
    },
    
    generateCalendar() {
        const container = Utils.$('#calendar-container');
        if (!container) return;
        
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        
        container.innerHTML = `
            <div class="calendar-header">
                <button class="calendar-nav-btn" id="prev-month" aria-label="Poprzedni miesiąc">‹</button>
                <h3 class="calendar-title">${this.getMonthName(month)} ${year}</h3>
                <button class="calendar-nav-btn" id="next-month" aria-label="Następny miesiąc">›</button>
            </div>
            <div class="calendar-grid" id="calendar-grid">
                ${this.generateCalendarDays(year, month)}
            </div>
        `;
        
        // Add event listeners
        Utils.$('#prev-month')?.addEventListener('click', () => this.navigateMonth(-1));
        Utils.$('#next-month')?.addEventListener('click', () => this.navigateMonth(1));
        
        // Add click listeners to days
        Utils.$$('.calendar-day').forEach(day => {
            day.addEventListener('click', () => {
                const date = day.dataset.date;
                if (date) this.openModal(date);
            });
        });
    },
    
    generateCalendarDays(year, month) {
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const startDate = new Date(firstDay);
        startDate.setDate(startDate.getDate() - firstDay.getDay());
        
        const days = [];
        const today = new Date().toDateString();
        
        for (let i = 0; i < 42; i++) {
            const currentDate = new Date(startDate);
            currentDate.setDate(startDate.getDate() + i);
            
            const dateStr = currentDate.toISOString().split('T')[0];
            const isCurrentMonth = currentDate.getMonth() === month;
            const isToday = currentDate.toDateString() === today;
            const hasNote = this.hasNote(dateStr);
            
            let classes = 'calendar-day';
            if (!isCurrentMonth) classes += ' other-month';
            if (isToday) classes += ' today';
            if (hasNote) classes += ' has-note';
            
            days.push(`
                <div class="${classes}" data-date="${dateStr}" tabindex="0" role="button" aria-label="Dzień ${currentDate.getDate()}">
                    ${currentDate.getDate()}
                </div>
            `);
        }
        
        return days.join('');
    },
    
    getMonthName(month) {
        const months = [
            'Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
            'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'
        ];
        return months[month];
    },
    
    navigateMonth(direction) {
        // Implementation for month navigation
        // This would require storing current month/year state
        console.log('Navigate month:', direction);
    },
    
    hasNote(dateStr) {
        try {
            const notes = JSON.parse(localStorage.getItem('notes') || '[]');
            return notes.some(note => note.date === dateStr);
        } catch {
            return false;
        }
    },
    
    setupModal() {
        const form = Utils.$('#note-form');
        const closeBtn = Utils.$('#modal-close-btn');
        
        if (form) {
            form.addEventListener('submit', (e) => this.handleSubmit(e));
        }
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.closeModal());
        }
        
        // Close modal on backdrop click
        const modal = Utils.$('#note-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeModal();
            });
        }
    },
    
    openModal(date) {
        const modal = Utils.$('#note-modal');
        const dateInput = Utils.$('#note-date');
        const nameInput = Utils.$('#note-name');
        
        if (modal) {
            modal.classList.remove('hidden');
            AppState.isModalOpen = true;
            document.body.style.overflow = 'hidden';
        }
        
        if (dateInput) dateInput.value = date;
        if (nameInput) nameInput.focus();
    },
    
    closeModal() {
        const modal = Utils.$('#note-modal');
        const form = Utils.$('#note-form');
        const feedback = Utils.$('#note-feedback');
        
        if (modal) {
            modal.classList.add('hidden');
            AppState.isModalOpen = false;
            document.body.style.overflow = '';
        }
        
        if (form) form.reset();
        if (feedback) {
            feedback.textContent = '';
            feedback.className = 'form-feedback';
        }
    },
    
    async handleSubmit(e) {
        e.preventDefault();
        
        const dateInput = Utils.$('#note-date');
        const nameInput = Utils.$('#note-name');
        const textInput = Utils.$('#note-text');
        const feedback = Utils.$('#note-feedback');
        
        const date = dateInput?.value || '';
        const name = nameInput?.value.trim() || '';
        const text = textInput?.value.trim() || '';
        
        // Validation
        if (!date || name.length < 2 || name.length > 50 || text.length < 5 || text.length > 1000) {
            this.showFeedback('Nieprawidłowe dane. Sprawdź wszystkie pola.', 'error');
            return;
        }
        
        try {
            const notes = JSON.parse(localStorage.getItem('notes') || '[]');
            notes.push({
                date,
                name,
                text,
                timestamp: new Date().toISOString()
            });
            localStorage.setItem('notes', JSON.stringify(notes));
            
            this.showFeedback('Notatka zapisana pomyślnie!', 'success');
            
            setTimeout(() => {
                this.closeModal();
                this.generateCalendar(); // Refresh calendar to show note indicator
            }, 1500);
            
        } catch (error) {
            console.error('Note save error:', error);
            this.showFeedback(`Błąd zapisu: ${error.message}`, 'error');
        }
    },
    
    showFeedback(message, type) {
        const feedback = Utils.$('#note-feedback');
        if (feedback) {
            feedback.textContent = message;
            feedback.className = `form-feedback ${type}`;
        }
    }
};

// ===== AI CHAT SIMULATOR =====
const ChatSimulator = {
    init() {
        this.setupChat();
        this.responses = [
            "Przesadzasz, jesteś zbyt wrażliwa/y.",
            "Nigdy czegoś takiego nie powiedziałem/am.",
            "Robię to dla twojego dobra.",
            "Gdybyś tylko bardziej się starał/a...",
            "Wszyscy myślą, że zwariowałeś/aś.",
            "Po tym wszystkim, co dla ciebie zrobiłem/am...",
            "To ty masz problem, nie ja.",
            "Zawsze wszystko przekręcasz.",
            "Jesteś niewdzięczny/a po tym wszystkim.",
            "Nikt cię nie zrozumie tak jak ja.",
            "Wymyślasz sobie rzeczy.",
            "Jesteś za bardzo emocjonalna/ny.",
            "Gdybyś mnie słuchał/a, nie byłoby problemów."
        ];
    },
    
    setupChat() {
        const form = Utils.$('#chat-form');
        if (form) {
            form.addEventListener('submit', (e) => this.handleMessage(e));
        }
    },
    
    handleMessage(e) {
        e.preventDefault();
        
        const input = Utils.$('#chat-input');
        const message = input?.value.trim();
        
        if (!message) return;
        
        this.addMessage(message, 'user');
        if (input) input.value = '';
        
        // Simulate AI response delay
        setTimeout(() => {
            const response = this.responses[Math.floor(Math.random() * this.responses.length)];
            this.addMessage(response, 'ai');
        }, 1000 + Math.random() * 1000);
    },
    
    addMessage(text, sender) {
        const container = Utils.$('#chat-container');
        if (!container) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${sender}`;
        
        const bubble = document.createElement('div');
        bubble.className = `chat-bubble ${sender}`;
        bubble.textContent = sender === 'user' ? `Ty: ${text}` : `AI: ${text}`;
        
        messageDiv.appendChild(bubble);
        container.appendChild(messageDiv);
        
        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    }
};

// ===== UI MANAGER =====
const UIManager = {
    init() {
        this.setupMobileMenu();
        this.setupBackToTop();
        this.setupSmoothScrolling();
        this.updateCurrentYear();
    },
    
    setupMobileMenu() {
        const toggle = Utils.$('#menu-toggle');
        const menu = Utils.$('#mobile-menu');
        
        if (toggle && menu) {
            toggle.addEventListener('click', () => {
                const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
                toggle.setAttribute('aria-expanded', (!isExpanded).toString());
                menu.classList.toggle('hidden');
            });
            
            // Close menu when clicking nav links
            Utils.$$('.nav-link').forEach(link => {
                link.addEventListener('click', () => {
                    toggle.setAttribute('aria-expanded', 'false');
                    menu.classList.add('hidden');
                });
            });
            
            // Close menu on escape
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && !menu.classList.contains('hidden')) {
                    toggle.setAttribute('aria-expanded', 'false');
                    menu.classList.add('hidden');
                    toggle.focus();
                }
            });
        }
    },
    
    setupBackToTop() {
        const button = Utils.$('#back-to-top');
        if (!button) return;
        
        const toggleVisibility = Utils.debounce(() => {
            if (window.scrollY > CONFIG.SCROLL_THRESHOLD) {
                button.classList.remove('hidden');
            } else {
                button.classList.add('hidden');
            }
        }, 100);
        
        window.addEventListener('scroll', toggleVisibility);
        
        button.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    },
    
    setupSmoothScrolling() {
        Utils.$$('a[href^="#"]').forEach(link => {
            link.addEventListener('click', (e) => {
                const href = link.getAttribute('href');
                if (href === '#') return;
                
                const target = Utils.$(href);
                if (target) {
                    e.preventDefault();
                    target.scrollIntoView({ behavior: 'smooth' });
                }
            });
        });
    },
    
    updateCurrentYear() {
        const yearElement = Utils.$('#current-year');
        if (yearElement) {
            yearElement.textContent = new Date().getFullYear().toString();
        }
    }
};

// ===== SINS GUIDE GENERATOR =====
const SinsGuide = {
    init() {
        this.generateSinsGrid();
    },
    
    generateSinsGrid() {
        const container = Utils.$('.sins-grid');
        if (!container) return;
        
        const sins = [
            {
                title: "Grzech 1: Branie pieniędzy z instytucji zamiast prawdziwej pomocy",
                description: "Toksyczna osoba stara się o świadczenia, ale nie zajmuje się podopiecznym, a jedynie zbiera fundusze.",
                example: "Matka pobiera zasiłek na dziecko, ale zaniedbuje jego potrzeby, wydając pieniądze na własne cele.",
                detection: [
                    "Czy fundusze są przeznaczane na cel, dla którego zostały przyznane?",
                    "Czy potrzeby podopiecznego są ignorowane?"
                ]
            },
            {
                title: "Grzech 2: Przerzucanie winy i granie ofiary",
                description: "Manipulant nigdy nie przyzna się do błędu, obwinia innych, grając rolę pokrzywdzonego.",
                example: "Matka opisuje syna jako &bdquo;niewdzięcznego&rdquo;, choć to ona zaniedbywała rodzinę.",
                detection: [
                    "Czy ktoś zawsze unika odpowiedzialności?",
                    "Czy gra ofiarę, by zyskać współczucie?"
                ]
            },
            {
                title: "Grzech 3: Gaslighting",
                description: "Podważanie percepcji ofiary, wmawianie, że &bdquo;przesadza&rdquo; lub &bdquo;wymyśla&rdquo;.",
                example: "Matka wpisała, że syn ma &bdquo;schizofrenię&rdquo; bez diagnozy, by go zdyskredytować.",
                detection: [
                    "Czy czujesz, że tracisz pewność siebie?",
                    "Czy ktoś podważa Twoje wspomnienia?"
                ]
            },
            {
                title: "Grzech 4: Inwigilacja i obsesyjna kontrola",
                description: "Notowanie każdego ruchu ofiary, zbieranie &bdquo;dowodów&rdquo; do szantażu.",
                example: "Notowanie godzin gaszenia światła jako &bdquo;dowód niewdzięczności&rdquo;.",
                detection: [
                    "Czy ktoś monitoruje Twoje działania?",
                    "Czy zbiera &bdquo;dowody&rdquo; na Twoje zachowanie?"
                ]
            },
            {
                title: "Grzech 5: Używanie instytucji jako broni",
                description: "Wciąganie policji, sądów, urzędów do rodzinnych konfliktów.",
                example: "Wzywanie dzielnicowego, by uzyskać &bdquo;papier&rdquo; na syna.",
                detection: [
                    "Czy ktoś grozi Ci instytucjami?",
                    "Czy eskaluje konflikty do poziomu urzędowego?"
                ]
            },
            {
                title: "Grzech 6: Szantaż emocjonalny i groźby",
                description: "Grożenie odebraniem domu, wykluczeniem z rodziny.",
                example: "&bdquo;Jak się nie podporządkujesz, to zabiorę ci wszystko&rdquo;.",
                detection: [
                    "Czy decyzje są wymuszane strachem?",
                    "Czy groźby dotyczą Twojej przyszłości?"
                ]
            },
            {
                title: "Grzech 7: Tworzenie chaosu i dezinformacji",
                description: "Zmiana wersji wydarzeń, sianie zamętu.",
                example: "Inna wersja dla policji, rodziny, sądu.",
                detection: [
                    "Czy historie tej osoby są sprzeczne?",
                    "Czy trudno uzyskać spójną odpowiedź?"
                ]
            },
            {
                title: "Grzech 8: Sianie podziałów i rozbijanie więzi",
                description: "Nastawianie rodziny przeciwko sobie, budowanie sojuszy.",
                example: "&bdquo;Twój brat też mówił, że masz problem&rdquo;.",
                detection: [
                    "Czy ktoś oczernia innych za plecami?",
                    "Czy rodzina przestała się wspierać?"
                ]
            }
        ];
        
        container.innerHTML = sins.map(sin => `
            <article class="sin-item">
                <h3 class="sin-title">${sin.title}</h3>
                <p class="sin-description">${sin.description}</p>
                <p class="sin-example"><strong>Przykład:</strong> ${sin.example}</p>
                <h4 class="sin-detection-title">Jak wykryć:</h4>
                <ul class="sin-detection-list">
                    ${sin.detection.map(item => `<li>${item}</li>`).join('')}
                </ul>
            </article>
        `).join('');
    }
};

// ===== MAIN APPLICATION =====
class RadioAdamowoApp {
    constructor() {
        this.initializeApp();
    }
    
    async initializeApp() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }
    
    async init() {
        try {
            console.log('🎵 Initializing Radio Adamowo...');
            
            // Initialize core components
            InfinityController.init();
            PWAManager.init();
            UIManager.init();
            KeyboardManager.init();
            
            // Initialize content generators
            SinsGuide.init();
            
            // Initialize interactive components
            NotesManager.init();
            ChatSimulator.init();
            
            // Initialize audio system (after user interaction)
            this.setupAutoplayOverlay();
            
            console.log('✅ Radio Adamowo initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize Radio Adamowo:', error);
            Utils.showToast('Błąd inicjalizacji aplikacji', 'error');
        }
    }
    
    setupAutoplayOverlay() {
        const overlay = Utils.$('#autoplay-overlay');
        const startBtn = Utils.$('#start-btn');
        
        if (startBtn) {
            startBtn.addEventListener('click', async () => {
                try {
                    // Hide overlay with animation
                    if (overlay) {
                        overlay.style.opacity = '0';
                        setTimeout(() => overlay.classList.add('hidden'), 500);
                    }
                    
                    // Initialize audio system
                    await AudioPlayer.initializeAudio();
                    await AudioPlayer.init();
                    await PlaylistManager.init();
                    
                    // Initialize media session
                    MediaSessionManager.init();
                    
                    // Initialize visualizer
                    Visualizer.init();
                    
                    Utils.showToast('System audio zainicjalizowany', 'success');
                    
                } catch (error) {
                    console.error('Failed to initialize audio system:', error);
                    Utils.showToast('Błąd inicjalizacji systemu audio', 'error');
                }
            });
        }
    }
}

// ===== GLOBAL FUNCTIONS FOR EXTERNAL ACCESS =====
window.RadioAdamowo = {
    // Infinity symbol speed control
    setInfinitySpeed(multiplier) {
        InfinityController.setSpeed(multiplier);
    },
    
    // Audio controls
    play() { return AudioPlayer.togglePlayPause(); },
    next() { return AudioPlayer.next(); },
    prev() { return AudioPlayer.prev(); },
    shuffle() { return AudioPlayer.toggleShuffle(); },
    mute() { return AudioPlayer.toggleMute(); },
    
    // Playlist controls
    setPlaylist(name) { return PlaylistManager.setPlaylist(name); },
    
    // Utility functions
    showToast(message, type) { return Utils.showToast(message, type); },
    
    // App state (read-only)
    get state() {
        return {
            isPlaying: AppState.isPlaying,
            currentTrack: AudioPlayer.getCurrentTrack(),
            isLiveMode: AppState.isLiveMode,
            isShuffled: AppState.isShuffled,
            isMuted: AppState.isMuted
        };
    }
};

// ===== INITIALIZE APPLICATION =====
new RadioAdamowoApp();

// ===== CSS ANIMATIONS (INJECTED) =====
const style = document.createElement('style');
style.textContent = `
    @keyframes slideInRight {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes slideOutRight {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);