class WhistleCounter {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.isRecording = false;
        this.isDetecting = false;
        
        // Calibration data
        this.calibrationSamples = [];
        this.currentCalibrationStep = 0;
        this.whistleProfile = null; // The active whistle profile
        this.savedProfiles = []; // Array to hold { name: string, profile: object }
        
        // Detection parameters
        this.targetWhistles = 3;
        this.currentCount = 0;
        this.lastDetectionTime = 0;
        this.detectionCooldown = 2000; // 2 seconds between detections
        
        // Audio analysis
        this.fftSize = 2048;
        this.frequencyData = new Uint8Array(this.fftSize / 2);
        this.smoothingTimeConstant = 0.8;
        
        this.initializeAudio();
                // Enhanced detection parameters
        this.detectionBuffer = []; // Store recent analysis frames
        this.bufferSize = 15; // Number of frames to analyze
        this.sustainedFrames = 0; // Count of consecutive matching frames
        this.requiredSustainedFrames = 8; // Minimum sustained frames for detection
        this.lastWhistleEnd = 0;
        this.minimumWhistleGap = 1000 * 30; // 30 sec between whistles
        
        // Frequency analysis improvements
        this.frequencyBins = 5; // Number of frequency bins to check
        this.harmonicCheck = true; // Check for harmonic patterns

        // Handle audio context resume
        this.audioResumed = false;
        
        // Add click listener to resume audio context
        document.addEventListener('click', () => {
            if (!this.audioResumed && this.audioContext && this.audioContext.state === 'suspended') {
                this.audioContext.resume().then(() => {
                    console.log('Audio context resumed');
                    this.audioResumed = true;
                });
            }
        });

        // Load profiles on initialization
        console.log('WhistleCounter constructor: Calling loadProfiles...');
        this.loadProfiles(); 
        console.log('WhistleCounter constructor: savedProfiles array after initial load:', this.savedProfiles); 
    }

async initializeAudio() {
    try {
        console.log('Requesting microphone access...');
        
        // Request microphone access
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                sampleRate: 44100,
                channelCount: 1,
                echoCancellation: false,
                noiseSuppression: false
            } 
        });
        
        console.log('Microphone access granted');
        
        // Create audio context
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        // Resume audio context if it's suspended
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        
        this.microphone = this.audioContext.createMediaStreamSource(stream);
        
        // Create analyser
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = this.fftSize;
        this.analyser.smoothingTimeConstant = this.smoothingTimeConstant;
        
        // Connect audio nodes
        this.microphone.connect(this.analyser);
        
        console.log('Audio initialized successfully');
        this.showStatus('Audio initialized. Ready to start!', 'info');
        
    } catch (error) {
        console.error('Error initializing audio:', error);
        
        if (error.name === 'NotAllowedError') {
            this.showStatus('Microphone access denied. Please allow microphone access and refresh the page.', 'error');
        } else if (error.name === 'NotFoundError') {
            this.showStatus('No microphone found. Please connect a microphone and refresh the page.', 'error');
        } else {
            this.showStatus('Error accessing microphone: ' + error.message, 'error');
        }
    }
}

    showStatus(message, type = 'info') {
        const statusElements = document.querySelectorAll('.status');
        statusElements.forEach(element => {
            if (element.style.display !== 'none') {
                element.textContent = message;
                element.className = `status ${type}`;
            }
        });
    }

    // Enhanced frequency analysis
    analyzeFrequencyAdvanced() {
        if (!this.analyser) return null;
        
        this.analyser.getByteFrequencyData(this.frequencyData);
        
        const nyquist = this.audioContext.sampleRate / 2;
        const frequencyResolution = nyquist / this.frequencyData.length;
        
        // Find the single strongest peak in whistle range
        let maxAmplitude = 0;
        let peakFrequency = 0;
        let peakIndex = 0;
        
        // Broader frequency range for calibration
        const minFreq = 1000;  // Lower bound
        const maxFreq = 6000;  // Higher bound
        
        for (let i = 0; i < this.frequencyData.length; i++) {
            const frequency = i * frequencyResolution;
            const amplitude = this.frequencyData[i];
            
            if (frequency >= minFreq && frequency <= maxFreq && amplitude > maxAmplitude) {
                maxAmplitude = amplitude;
                peakFrequency = frequency;
                peakIndex = i;
            }
        }
        
        // Create dominant peak object
        const dominantPeak = maxAmplitude > 20 ? {  // Lower threshold
            frequency: peakFrequency,
            amplitude: maxAmplitude,
            index: peakIndex
        } : null;
        
        // Calculate energy ratios
        const whistleEnergy = this.calculateEnergyInRange(minFreq, maxFreq);
        const noiseEnergy = this.calculateEnergyInRange(100, 1000) + 
                          this.calculateEnergyInRange(6000, 10000);
        const totalEnergy = this.frequencyData.reduce((sum, val) => sum + val * val, 0);
        
        const signalToNoiseRatio = whistleEnergy / Math.max(noiseEnergy, 1);
        
        return {
            dominantPeak: dominantPeak,
            totalEnergy: totalEnergy,
            whistleEnergy: whistleEnergy,
            noiseEnergy: noiseEnergy,
            signalToNoiseRatio: signalToNoiseRatio,
            maxAmplitude: maxAmplitude,
            peakFrequency: peakFrequency,
            timestamp: Date.now()
        };
    }

     calculateEnergyInRange(minFreq, maxFreq) {
        const nyquist = this.audioContext.sampleRate / 2;
        const frequencyResolution = nyquist / this.frequencyData.length;
        
        const startIndex = Math.floor(minFreq / frequencyResolution);
        const endIndex = Math.floor(maxFreq / frequencyResolution);
        
        let energy = 0;
        for (let i = startIndex; i <= endIndex && i < this.frequencyData.length; i++) {
            energy += this.frequencyData[i] * this.frequencyData[i];
        }
        return energy;
    }

    // Visualization
    drawFrequencySpectrum(canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        
        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        
        if (!this.frequencyData) return;
        
        // Draw frequency bars
        const barWidth = width / this.frequencyData.length;
        
        for (let i = 0; i < this.frequencyData.length; i++) {
            const barHeight = (this.frequencyData[i] / 255) * height;
            const x = i * barWidth;
            const y = height - barHeight;
            
            // Color based on frequency range
            const frequency = (i / this.frequencyData.length) * (this.audioContext.sampleRate / 2);
            if (frequency >= 1000 && frequency <= 5000) {
                ctx.fillStyle = `rgb(${this.frequencyData[i]}, 100, 100)`;
            } else {
                ctx.fillStyle = `rgb(100, 100, ${this.frequencyData[i]})`;
            }
            
            ctx.fillRect(x, y, barWidth, barHeight);
        }
        
        // Draw whistle profile if available
        if (this.whistleProfile) {
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2;
            ctx.beginPath();
            
            const minFreqIndex = Math.floor((this.whistleProfile.minFrequency / (this.audioContext.sampleRate / 2)) * this.frequencyData.length);
            const maxFreqIndex = Math.floor((this.whistleProfile.maxFrequency / (this.audioContext.sampleRate / 2)) * this.frequencyData.length);
            
            ctx.moveTo(minFreqIndex * barWidth, 0);
            ctx.lineTo(minFreqIndex * barWidth, height);
            ctx.moveTo(maxFreqIndex * barWidth, 0);
            ctx.lineTo(maxFreqIndex * barWidth, height);
            ctx.stroke();
        }
    }

    // Recording functions
    startRecording() {
        if (!this.audioContext) {
            this.showStatus('Audio not initialized. Please refresh and allow microphone access.', 'error');
            return false;
        }
        
        console.log('Starting recording...');
        this.isRecording = true;
        this.recordingData = [];
        this.recordingStartTime = Date.now();
        
        // Start recording loop
        this.recordingLoop();
        
        // Auto-stop after 5 seconds
        this.recordingTimeout = setTimeout(() => {
            if (this.isRecording) {
                console.log('Auto-stopping recording after 5 seconds');
                this.stopRecording();
            }
        }, 5000);
        
        return true;
    }
    
        recordingLoop() {
        if (!this.isRecording) {
            console.log('Recording loop stopped');
            return;
        }
        
        try {
            const analysis = this.analyzeFrequencyAdvanced();
            if (analysis) {
                this.recordingData.push(analysis);
                
                // Update visualization
                this.drawFrequencySpectrum('frequency-canvas');
                
                // Show real-time feedback
                const elapsed = Date.now() - this.recordingStartTime;
                const remaining = Math.max(0, 5000 - elapsed);
                
                let statusMessage = `Recording... ${(remaining/1000).toFixed(1)}s remaining`;
                
                if (analysis.dominantPeak) {
                    statusMessage += ` | Detected: ${analysis.dominantPeak.frequency.toFixed(0)}Hz (${analysis.dominantPeak.amplitude})`;
                } else {
                    statusMessage += ` | No clear peak detected`;
                }
                
                this.showStatus(statusMessage, 'info');
            }
        } catch (error) {
            console.error('Error in recording loop:', error);
        }
        
        // Continue recording
        requestAnimationFrame(() => this.recordingLoop());
    }

    stopRecording() {
        console.log('Stopping recording...');
        this.isRecording = false;
        
        // Clear timeout if it exists
        if (this.recordingTimeout) {
            clearTimeout(this.recordingTimeout);
            this.recordingTimeout = null;
        }
        
        // Update UI
        const recordBtn = document.getElementById('record-btn');
        recordBtn.textContent = '🎤 Record Whistle';
        recordBtn.classList.remove('recording');
        recordBtn.disabled = false;
        
        // Process the recording
        if (this.recordingData && this.recordingData.length > 0) {
            this.showStatus('Processing recording...', 'info');
            setTimeout(() => {
                this.processRecording();
            }, 100);
        } else {
            this.showStatus('No audio data recorded. Please try again.', 'error');
        }
    }

    processRecording() {
        if (this.recordingData.length === 0) {
            this.showStatus('No audio data recorded. Please try again.', 'error');
            return;
        }

        // Analyze the recording to find whistle characteristics
        const whistleData = this.analyzeWhistleFromRecording(this.recordingData);
        
        if (whistleData) {
            this.calibrationSamples.push(whistleData);
            this.showStatus(`Sample ${this.currentCalibrationStep + 1} recorded successfully!`, 'info');
            
            // Enable next button
            document.getElementById('next-btn').disabled = false;
            document.getElementById('retry-btn').disabled = false;
        } else {
            this.showStatus('No clear whistle detected. Please try again.', 'warning');
            document.getElementById('retry-btn').disabled = false;
        }
    }

    analyzeWhistleFromRecording(recordingData) {
        console.log('Analyzing recording data, frames:', recordingData.length);
        
        if (recordingData.length === 0) {
            console.log('No recording data available');
            return null;
        }
        
        // Find the loudest sustained frequency
        const frequencyMap = new Map();
        let maxAmplitude = 0;
        let validFrames = 0;
        
        // Analyze each frame with lower thresholds for calibration
        recordingData.forEach((frame, index) => {
            if (frame.dominantPeak) {
                const peak = frame.dominantPeak;
                maxAmplitude = Math.max(maxAmplitude, peak.amplitude);
                
                // Lower threshold for calibration - accept weaker signals
                if (peak.amplitude > 30 && peak.frequency >= 1000 && peak.frequency <= 6000) {
                    validFrames++;
                    const freq = Math.round(peak.frequency / 20) * 20; // Round to nearest 20Hz
                    
                    if (!frequencyMap.has(freq)) {
                        frequencyMap.set(freq, []);
                    }
                    frequencyMap.get(freq).push({
                        amplitude: peak.amplitude,
                        frame: index
                    });
                }
            }
        });

        console.log('Valid frames:', validFrames, 'Max amplitude:', maxAmplitude);
        console.log('Frequency map size:', frequencyMap.size);
        
        // Debug: log top frequencies
        const freqDebug = Array.from(frequencyMap.entries())
            .map(([freq, data]) => ({
                freq: freq,
                count: data.length,
                avgAmp: data.reduce((sum, d) => sum + d.amplitude, 0) / data.length
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);
        
        console.log('Top frequencies:', freqDebug);

        // Find the most consistent frequency with lower requirements
        let bestFrequency = 0;
        let bestScore = 0;
        let bestData = null;
        
        frequencyMap.forEach((amplitudes, frequency) => {
            // Require at least 5 frames (was 10) - more lenient
            if (amplitudes.length >= 5) {
                const avgAmplitude = amplitudes.reduce((a, b) => a + b.amplitude, 0) / amplitudes.length;
                const consistency = amplitudes.length;
                const score = avgAmplitude * consistency;
                
                if (score > bestScore) {
                    bestScore = score;
                    bestFrequency = frequency;
                    bestData = amplitudes;
                }
            }
        });

        console.log('Best frequency:', bestFrequency, 'Score:', bestScore);

        if (bestFrequency > 0 && bestData) {
            const result = {
                frequency: bestFrequency,
                amplitude: bestData.reduce((a, b) => a + b.amplitude, 0) / bestData.length,
                consistency: bestData.length,
                maxAmplitude: Math.max(...bestData.map(d => d.amplitude)),
                timestamp: Date.now()
            };
            
            console.log('Calibration sample result:', result);
            return result;
        }

        console.log('No suitable frequency found');
        return null;
    }

 createWhistleProfile() {
        if (this.calibrationSamples.length < 2) {
            return null;
        }

        const frequencies = this.calibrationSamples.map(sample => sample.frequency);
        const amplitudes = this.calibrationSamples.map(sample => sample.amplitude);

        // Calculate statistics
        const avgFrequency = frequencies.reduce((a, b) => a + b, 0) / frequencies.length;
        const avgAmplitude = amplitudes.reduce((a, b) => a + b, 0) / amplitudes.length;
        
        // Calculate more conservative frequency range
        const freqVariance = frequencies.reduce((sum, freq) => sum + Math.pow(freq - avgFrequency, 2), 0) / frequencies.length;
        const freqStdDev = Math.sqrt(freqVariance);
        
        // Use tighter frequency bounds
        const freqTolerance = Math.max(freqStdDev * 1.5, 80); // Tighter tolerance
        
        this.whistleProfile = {
            targetFrequency: avgFrequency,
            minFrequency: avgFrequency - freqTolerance,
            maxFrequency: avgFrequency + freqTolerance,
            minAmplitude: Math.max(avgAmplitude * 0.7, 100), // Higher amplitude threshold
            maxAmplitude: avgAmplitude * 2.0,
            samples: this.calibrationSamples.length
        };

        console.log('Enhanced whistle profile created:', this.whistleProfile);
        return this.whistleProfile;
    }

    // Detection functions
    startDetection() {
        if (!this.whistleProfile) {
            this.showStatus('No whistle profile available. Please calibrate first or load a saved profile.', 'error');
            return;
        }

        this.isDetecting = true;
        this.sustainedFrames = 0;
        this.detectionBuffer = [];
        this.lastWhistleEnd = Date.now() - this.minimumWhistleGap; // Allow immediate first detection
        this.detectionLoop();
    }

   // Enhanced detection with multiple validation layers
    detectionLoop() {
        if (!this.isDetecting) return;

        const analysis = this.analyzeFrequencyAdvanced();
        if (analysis) {
            // Show debug info
            this.showDebugInfo(analysis);
            // Add to buffer
            this.detectionBuffer.push(analysis);
            if (this.detectionBuffer.length > this.bufferSize) {
                this.detectionBuffer.shift();
            }
            
            // Check for whistle pattern
            if (this.isWhistlePattern()) {
                this.sustainedFrames++;
                
                // Only trigger detection after sustained pattern
                if (this.sustainedFrames >= this.requiredSustainedFrames) {
                    if (this.canDetectNewWhistle()) {
                        this.onWhistleDetected();
                        this.sustainedFrames = 0; // Reset counter
                        this.lastWhistleEnd = Date.now();
                    }
                }
            } else {
                // Reset sustained counter if pattern breaks
                if (this.sustainedFrames > 0) {
                    this.sustainedFrames = Math.max(0, this.sustainedFrames - 2);
                }
            }
            
            // Update visualization
            const activeCanvas = document.querySelector('.step.active canvas');
            if (activeCanvas) {
                this.drawFrequencySpectrum(activeCanvas.id);
            }
        }

        requestAnimationFrame(() => this.detectionLoop());
    }

    isWhistlePattern() {
        if (!this.whistleProfile || this.detectionBuffer.length < 3) { // Reduced from 5
            return false;
        }

        // Get recent frames for analysis
        const recentFrames = this.detectionBuffer.slice(-3); // Reduced from 5
        
        // Check each frame
        let matchingFrames = 0;
        for (let frame of recentFrames) {
            if (this.frameMatchesWhistle(frame)) {
                matchingFrames++;
            }
        }
        
        // Require at least 2 out of 3 recent frames to match (was 4 out of 5)
        return matchingFrames >= 2;
    }

frameMatchesWhistle(frame) {
    if (!frame.dominantPeak) {
        console.log('No dominant peak');
        return false;
    }
    
    const peak = frame.dominantPeak;
    
    // 1. Frequency range check
    const freqMatch = peak.frequency >= this.whistleProfile.minFrequency && 
                     peak.frequency <= this.whistleProfile.maxFrequency;
    
    if (!freqMatch) {
        console.log(`Frequency mismatch: ${peak.frequency} not in range ${this.whistleProfile.minFrequency}-${this.whistleProfile.maxFrequency}`);
        return false;
    }
    
    // 2. Amplitude check - make this more lenient
    const ampMatch = peak.amplitude >= this.whistleProfile.minAmplitude * 0.5; // 50% of calibrated amplitude
    
    if (!ampMatch) {
        console.log(`Amplitude too low: ${peak.amplitude} < ${this.whistleProfile.minAmplitude * 0.5}`);
        return false;
    }
    
    // 3. Signal-to-noise ratio check - make more lenient
    const snrMatch = frame.signalToNoiseRatio > 2.0; // Reduced from 3.0
    
    if (!snrMatch) {
        console.log(`SNR too low: ${frame.signalToNoiseRatio} < 2.0`);
        return false;
    }
    
    // 4. Energy concentration check - make more lenient
    const energyRatio = frame.whistleEnergy / Math.max(frame.totalEnergy, 1);
    const energyMatch = energyRatio > 0.15; // Reduced from 0.3
    
    if (!energyMatch) {
        console.log(`Energy ratio too low: ${energyRatio} < 0.15`);
        return false;
    }
    
    // 5. Tonal quality check - make more lenient
    // This part of the original code snippet (frame.peaks) isn't explicitly defined/calculated.
    // For now, let's simplify or remove this check if 'frame.peaks' is not populated.
    // Assuming 'frame.peaks' is not available in the provided `analyzeFrequencyAdvanced`,
    // this check might always return true or false unexpectedly.
    // For demonstration, let's just make it always true for now if 'peaks' is not available.
    const tonalMatch = true; 
    /* Original check - commented out as 'frame.peaks' isn't derived:
    const competingPeaks = frame.peaks ? frame.peaks.filter(p => 
        p.amplitude > peak.amplitude * 0.8 && // Increased from 0.6
        Math.abs(p.frequency - peak.frequency) > 300 // Increased from 200
    ).length : 0;
    const tonalMatch = competingPeaks <= 2; // Increased from 1
    if (!tonalMatch) {
        console.log(`Too many competing peaks: ${competingPeaks}`);
        return false;
    }
    */
    
    console.log('Frame matches whistle! ✓');
    return true;
}

    canDetectNewWhistle() {
        const now = Date.now();
        return (now - this.lastWhistleEnd) > this.minimumWhistleGap;
    }

    onWhistleDetected() {
        this.lastDetectionTime = Date.now();
        this.currentCount++;
        
        // Update UI
        this.updateCounterDisplay();
        
        // Check if target reached
        if (this.currentCount >= this.targetWhistles) {
            this.onTargetReached();
        }
        
        console.log(`Whistle detected! Count: ${this.currentCount}`);
    }

    updateCounterDisplay() {
        const counterElements = document.querySelectorAll('.counter');
        counterElements.forEach(element => {
            if (element.style.display !== 'none') {
                element.textContent = this.currentCount;
            }
        });
    }

    onTargetReached() {
        this.isDetecting = false;
        
        // Show notification
        this.showStatus(`Target reached! ${this.currentCount} whistles detected.`, 'info');
        
        // Play alarm sound
        this.playAlarm();
        
        // Browser notification
        if (Notification.permission === 'granted') {
            new Notification('Cooker Ready!', {
                body: `${this.currentCount} whistles completed`,
                icon: '🍲'
            });
        }
    }

    playAlarm() {
        // Create a simple beep sound
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);
        
        oscillator.frequency.setValueAtTime(800, this.audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
        
        oscillator.start();
        oscillator.stop(this.audioContext.currentTime + 0.5);
        
        // Repeat beep 3 times
        setTimeout(() => {
            const osc2 = this.audioContext.createOscillator();
            const gain2 = this.audioContext.createGain();
            osc2.connect(gain2);
            gain2.connect(this.audioContext.destination);
            osc2.frequency.setValueAtTime(1000, this.audioContext.currentTime);
            gain2.gain.setValueAtTime(0.3, this.audioContext.currentTime);
            osc2.start();
            osc2.stop(this.audioContext.currentTime + 0.5);
        }, 600);
    }

    stopDetection() {
        this.isDetecting = false;
    }

    resetCounter() {
        this.currentCount = 0;
        this.updateCounterDisplay();
    }

    // Add this method to the WhistleCounter class
showDebugInfo(analysis) {
    if (!analysis || !this.whistleProfile) { // Ensure whistleProfile is available
        // Clear debug info if no profile is active or analysis is null
        const debugDiv = document.getElementById('debug-info');
        if (debugDiv) {
            debugDiv.innerHTML = `<strong>Debug Info:</strong><br>No active profile or analysis data.`;
        }
        return;
    }
    
    const debugDiv = document.getElementById('debug-info');
    if (debugDiv) {
        const peak = analysis.dominantPeak;
        const energyRatio = analysis.whistleEnergy / Math.max(analysis.totalEnergy, 1);
        
        debugDiv.innerHTML = `
            <strong>Debug Info:</strong><br>
            Peak Frequency: ${peak ? peak.frequency.toFixed(1) : 'None'} Hz<br>
            Peak Amplitude: ${peak ? peak.amplitude.toFixed(1) : 'None'}<br>
            Signal/Noise Ratio: ${analysis.signalToNoiseRatio.toFixed(2)}<br>
            Energy Ratio: ${energyRatio.toFixed(3)}<br>
            Sustained Frames: ${this.sustainedFrames}/${this.requiredSustainedFrames}<br>
            Profile Range: ${this.whistleProfile.minFrequency.toFixed(1) + '-' + this.whistleProfile.maxFrequency.toFixed(1) + ' Hz'}<br>
            Min Amplitude: ${(this.whistleProfile.minAmplitude * 0.5).toFixed(1)}<br>
            <strong>Pattern Match:</strong> ${this.isWhistlePattern() ? '✓' : '✗'}
        `;
    }
}

    // --- Profile Management Methods ---
 async loadProfiles() {
        try {
            const storedProfiles = localStorage.getItem('cookerWhistleProfiles');
            console.log('loadProfiles: Raw data from localStorage for "cookerWhistleProfiles":', storedProfiles); 

            if (storedProfiles) {
                this.savedProfiles = JSON.parse(storedProfiles);
                console.log('loadProfiles: Successfully parsed saved profiles:', this.savedProfiles);
            } else {
                this.savedProfiles = [];
                console.log('loadProfiles: No stored profiles found, initializing empty array.');
            }
            // CALL THE CLASS METHOD HERE
            this.populateSavedProfilesDropdown(); 
        } catch (error) {
            console.error('Error loading profiles from localStorage:', error);
            this.savedProfiles = [];
            this.showStatus('Error loading saved profiles. Data might be corrupted or browser storage is full.', 'error');
        }
    }

    async saveProfile(name) {
        if (!this.whistleProfile) {
            this.showStatus('No whistle profile to save. Please calibrate first.', 'warning');
            return false;
        }
        if (!name) {
            this.showStatus('Please enter a name for the profile.', 'warning');
            return false;
        }

        const existingIndex = this.savedProfiles.findIndex(p => p.name.toLowerCase() === name.toLowerCase());

        const profileToSave = {
            name: name,
            profile: this.whistleProfile
        };

        if (existingIndex !== -1) {
            this.savedProfiles[existingIndex] = profileToSave;
            this.showStatus(`Profile "${name}" updated!`, 'info');
        } else {
            this.savedProfiles.push(profileToSave);
            this.showStatus(`Profile "${name}" saved!`, 'info');
        }

        try {
            localStorage.setItem('cookerWhistleProfiles', JSON.stringify(this.savedProfiles));
            // CALL THE CLASS METHOD HERE
            this.populateSavedProfilesDropdown(); 
            return true;
        } catch (error) {
            console.error('Error saving profile to localStorage:', error);
            this.showStatus('Error saving profile. Storage might be full or corrupted.', 'error');
            return false;
        }
    }

    async loadProfile(name) {
        const profileData = this.savedProfiles.find(p => p.name === name);
        if (profileData) {
            this.whistleProfile = profileData.profile;
            this.showStatus(`Profile "${name}" loaded!`, 'info');
            console.log('Active whistle profile set to:', this.whistleProfile);
            return true;
        } else {
            this.showStatus(`Profile "${name}" not found.`, 'error');
            return false;
        }
    }

    async deleteProfile(name) {
        const initialLength = this.savedProfiles.length;
        this.savedProfiles = this.savedProfiles.filter(p => p.name !== name);
        
        if (this.savedProfiles.length < initialLength) {
            try {
                localStorage.setItem('cookerWhistleProfiles', JSON.stringify(this.savedProfiles));
                // CALL THE CLASS METHOD HERE
                this.populateSavedProfilesDropdown(); 
                this.showStatus(`Profile "${name}" deleted.`, 'info');
                if (this.whistleProfile && this.whistleProfile.name === name) {
                     this.whistleProfile = null;
                }
                return true;
            } catch (error) {
                console.error('Error deleting profile from localStorage:', error);
                this.showStatus('Error deleting profile.', 'error');
                return false;
            }
        } else {
            this.showStatus(`Profile "${name}" not found for deletion.`, 'warning');
            return false;
        }
    }

        populateSavedProfilesDropdown() { // No 'function' keyword here
        const selectElement = document.getElementById('profile-select');
        selectElement.innerHTML = ''; // Clear existing options

        console.log('populateSavedProfilesDropdown: Currently available savedProfiles:', this.savedProfiles); // Use this.savedProfiles

        if (this.savedProfiles.length === 0) { // Use this.savedProfiles
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No saved profiles';
            selectElement.appendChild(option);
            document.getElementById('load-profile-btn').disabled = true;
            document.getElementById('delete-profile-btn').disabled = true;
        } else {
            this.savedProfiles.forEach(profile => { // Use this.savedProfiles
                const option = document.createElement('option');
                option.value = profile.name;
                option.textContent = profile.name;
                selectElement.appendChild(option);
            });
            
            let selectedValue = '';
            if (this.whistleProfile) { // Use this.whistleProfile
                const activeProfileEntry = this.savedProfiles.find(p => // Use this.savedProfiles
                    p.profile && 
                    p.profile.targetFrequency === this.whistleProfile.targetFrequency &&
                    p.profile.minFrequency === this.whistleProfile.minFrequency &&
                    p.profile.maxFrequency === this.whistleProfile.maxFrequency &&
                    p.profile.minAmplitude === this.whistleProfile.minAmplitude
                );
                if (activeProfileEntry) {
                    selectedValue = activeProfileEntry.name;
                }
            }
            
            if (!selectedValue && selectElement.options.length > 0) {
                selectedValue = selectElement.options[0].value;
            }

            selectElement.value = selectedValue;
            console.log(`populateSavedProfilesDropdown: Dropdown set to value: "${selectElement.value}"`);

            document.getElementById('load-profile-btn').disabled = false;
            document.getElementById('delete-profile-btn').disabled = false;
        }
    }
}

// Global instance
let whistleCounter = new WhistleCounter();

// UI Functions
function showStep(stepId) {
    document.querySelectorAll('.step').forEach(step => step.classList.remove('active'));
    document.getElementById(stepId).classList.add('active');
}

function startCalibration() {
    showStep('step-calibration');
    whistleCounter.currentCalibrationStep = 0;
    whistleCounter.calibrationSamples = [];
    whistleCounter.whistleProfile = null; // Clear active profile for new calibration
    updateCalibrationUI();
}

function updateCalibrationUI() {
    const stepNum = whistleCounter.currentCalibrationStep + 1;
    document.getElementById('calibration-step').textContent = stepNum;
    document.getElementById('calibration-status').textContent = `Ready to record sample ${stepNum}`;
    
    // Reset buttons
    document.getElementById('retry-btn').disabled = true;
    document.getElementById('next-btn').disabled = true;
    document.getElementById('record-btn').disabled = false;
}

// UI Event Handlers
function manualCalibration() {
    // Allow user to manually input their whistle frequency
    const frequency = prompt('Enter your whistle frequency in Hz (usually between 2000-4000):');
    if (frequency && !isNaN(frequency)) {
        const freq = parseFloat(frequency);
        if (freq >= 1000 && freq <= 6000) {
            // Create a manual calibration sample
            const manualSample = {
                frequency: freq,
                amplitude: 150, // Reasonable amplitude
                consistency: 20,
                maxAmplitude: 200,
                timestamp: Date.now()
            };
            
            whistleCounter.calibrationSamples.push(manualSample);
            whistleCounter.showStatus(`Manual sample added: ${freq}Hz`, 'info');
            
            // Enable next button
            document.getElementById('next-btn').disabled = false;
            document.getElementById('retry-btn').disabled = false;
        } else {
            whistleCounter.showStatus('Frequency out of valid range (1000-6000 Hz).', 'warning');
        }
    } else if (frequency !== null) { // User clicked OK but entered invalid input
        whistleCounter.showStatus('Invalid frequency entered. Please enter a number.', 'warning');
    }
}

// Fix the toggleRecording function
function toggleRecording() {
    const recordBtn = document.getElementById('record-btn');
    
    if (whistleCounter.isRecording) {
        // Stop recording
        whistleCounter.stopRecording();
        recordBtn.textContent = '🎤 Record Whistle';
        recordBtn.classList.remove('recording');
        recordBtn.disabled = false;
    } else {
        // Start recording
        if (!whistleCounter.audioContext) {
            whistleCounter.showStatus('Audio not initialized. Please refresh and allow microphone access.', 'error');
            return;
        }
        
        // Update UI immediately
        recordBtn.textContent = '🔴 Recording... (5s max)';
        recordBtn.classList.add('recording');
        recordBtn.disabled = true;
        whistleCounter.showStatus('Recording whistle sound...', 'info');
        
        // Start the actual recording
        whistleCounter.startRecording();
    }
}

function retryCalibration() {
    whistleCounter.showStatus(`Ready to record sample ${whistleCounter.currentCalibrationStep + 1}`, 'info');
    document.getElementById('retry-btn').disabled = true;
    document.getElementById('next-btn').disabled = true;
    document.getElementById('record-btn').disabled = false;
}

function nextCalibration() {
    whistleCounter.currentCalibrationStep++;
    
    if (whistleCounter.currentCalibrationStep >= 3) {
        // Calibration complete
        whistleCounter.createWhistleProfile();
        showStep('step-validation');
    } else {
        // Next sample
        updateCalibrationUI();
    }
}

function startValidation() {
    whistleCounter.currentCount = 0;
    whistleCounter.updateCounterDisplay();
    whistleCounter.startDetection();
    whistleCounter.showStatus('Detection active - make your cooker whistle!', 'info');
    
    document.getElementById('validate-btn').textContent = 'Stop Test';
    document.getElementById('validate-btn').onclick = stopValidation;
}

function stopValidation() {
    whistleCounter.stopDetection();
    whistleCounter.showStatus('Test stopped', 'info');
    
    document.getElementById('validate-btn').textContent = 'Start Test';
    document.getElementById('validate-btn').onclick = startValidation;
}

function recalibrate() {
    whistleCounter.calibrationSamples = [];
    whistleCounter.currentCalibrationStep = 0;
    whistleCounter.whistleProfile = null; // Clear active profile to force recalibration
    showStep('step-calibration');
    updateCalibrationUI();
}

function finishCalibration() {
    showStep('step-counter');
    whistleCounter.stopDetection();
    whistleCounter.resetCounter();
    
    // Request notification permission
    if (Notification.permission === 'default') {
        Notification.requestPermission();
    }

    // Show calibration management section
    document.getElementById('calibration-management').style.display = 'block';
    whistleCounter.populateSavedProfilesDropdown(); // Ensure dropdown is populated
    
    // Auto-fill profile name input if it's the first calibration or only one exists
    if (whistleCounter.savedProfiles.length === 0) {
        document.getElementById('profile-name-input').value = 'My Cooker';
    } else if (whistleCounter.savedProfiles.length === 1) {
        document.getElementById('profile-name-input').value = whistleCounter.savedProfiles[0].name;
    } else {
        document.getElementById('profile-name-input').value = ''; // Clear for new save
    }
}

function startCounting() {
    if (!whistleCounter.whistleProfile) {
        whistleCounter.showStatus('Please calibrate your cooker or load a saved profile before counting.', 'warning');
        return;
    }
    const targetInput = document.getElementById('target-input');
    whistleCounter.targetWhistles = parseInt(targetInput.value) || 3;
    whistleCounter.resetCounter();
    whistleCounter.startDetection();
    
    whistleCounter.showStatus(`Counting whistles... Target: ${whistleCounter.targetWhistles}`, 'info');
    
    document.getElementById('start-btn').disabled = true;
    document.getElementById('stop-btn').disabled = false;
}

function stopCounting() {
    whistleCounter.stopDetection();
    whistleCounter.showStatus('Counting stopped', 'info');
    
    document.getElementById('start-btn').disabled = false;
    document.getElementById('stop-btn').disabled = true;
}

function resetCounter() {
    whistleCounter.resetCounter();
    whistleCounter.showStatus('Counter reset', 'info');
}

function showSettings() {
    alert('Settings panel coming soon! For now, you can manage profiles below.');
}

// New UI functions for profile management

function saveCurrentProfile() {
    const profileNameInput = document.getElementById('profile-name-input');
    const name = profileNameInput.value.trim();

    if (name) {
        whistleCounter.saveProfile(name);
    } else {
        whistleCounter.showStatus('Please enter a name for your cooker profile.', 'warning');
    }
}

function loadSelectedProfile() {
    const selectElement = document.getElementById('profile-select');
    const selectedName = selectElement.value;
    if (selectedName) {
        whistleCounter.loadProfile(selectedName);
        // Optionally update the input field with the loaded profile name
        document.getElementById('profile-name-input').value = selectedName;
    } else {
        whistleCounter.showStatus('No profile selected to load.', 'warning');
    }
}

function deleteSelectedProfile() {
    const selectElement = document.getElementById('profile-select');
    const selectedName = selectElement.value;
    if (selectedName && confirm(`Are you sure you want to delete profile "${selectedName}"? This cannot be undone.`)) {
        whistleCounter.deleteProfile(selectedName);
        // If the deleted profile was the one shown in the input, clear it.
        if (document.getElementById('profile-name-input').value === selectedName) {
            document.getElementById('profile-name-input').value = '';
        }
    } else if (!selectedName) {
        whistleCounter.showStatus('No profile selected to delete.', 'warning');
    }
}


// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    console.log('Whistle Counter initialized');
    
    // Set canvas sizes
    const canvases = document.querySelectorAll('canvas');
    canvases.forEach(canvas => {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
    });

    // Load saved profiles on start
    // This is already called in the WhistleCounter constructor.
    // whistleCounter.loadProfiles(); 
});