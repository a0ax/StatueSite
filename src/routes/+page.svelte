<script lang="ts">
    import { onMount } from 'svelte';
    import * as THREE from 'three';
    import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
    import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
    import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
    import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
    import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
    import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
    import {
        fade,
    } from 'svelte/transition';
    import { cubicOut } from 'svelte/easing';

    interface Project {
        title: string;
        urls: Array<{ url: string; icon: string }>;

        description: string;
        tech: string;
        date: string;
        views?: string;
        downloads?: string;
    }

    interface PageData {
        projects: Project[];
    }

    let { data }: { data: PageData } = $props();

    let container = $state();
    let renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera;
    let spotLight: THREE.Object3D<THREE.Object3DEventMap>, lightHelper;
    let controls: OrbitControls;
    let accumulatedAngle = 0;
    let mouseX = 0;
    let mouseY = 0;
    let vignetteX = $state(0);
    let vignetteY = $state(0);
    let baseCameraPosition = { x: 3.30, y: -0.45, z: 4.66 };
    let baseCameraTarget = { x: -0.12, y: 0.88, z: 1.16 };
    
    // Lucy model camera settings (centered on model at origin)
    let lucyCameraPosition = { x: 0, y: 0.5, z: 3 };
    let lucyCameraTarget = { x: 0, y: 0, z: 0 };
    
    let composer: EffectComposer;
    let afterimageDamp = 1;
    let volumetricMesh: THREE.Mesh<THREE.BoxGeometry, THREE.RawShaderMaterial, THREE.Object3DEventMap>;
    let skyMesh;
    let stars: THREE.Points<THREE.BufferGeometry<THREE.NormalBufferAttributes, THREE.BufferGeometryEventMap>, THREE.PointsMaterial, THREE.Object3DEventMap>;
    let controlsEnabled = false;
    let isMobile = false;
    let initialOrientation = { beta: 0, gamma: 0 };
    let hasOrientationPermission = false;
    let scrollContainer = $state();
    let scrollAngle = $state(0); // Camera rotation angle based on scroll
    let targetScrollAngle = $state(0); // Target angle for smooth interpolation
    
    // WASD movement
    let keys = { w: false, a: false, s: false, d: false, q: false, e: false, shift: false };
    let moveSpeed = 0.1;
    
    // Hover state tracking for coordinated title/icon effects
    let hoveredTitleIndex = $state(-1);
    let hoveredFirstIconIndex = $state(-1);
    let hoveredIconIndex = $state(null);
    
    // Email copy state
    let emailCopied = $state(false);
    
    // Loading states for progressive rendering
    let coreSceneLoaded = $state(false);
    let modelLoaded = $state(false);
    let effectsLoaded = $state(false);
    let showSplash = $state(true);
    let sceneReady = $state(false);

    onMount(() => {
        initCoreScene();
        return () => {
            // Cleanup
            if (renderer) {
                renderer.dispose(); 
            }
            if (controls) {
                controls.dispose();
            }
        };
    });

    async function initCoreScene() {
        try {
            // Initialize core scene components first
            await setupRenderer();
            await setupScene();
            await setupCamera();
            await setupLighting();
            
            coreSceneLoaded = true;
            
            // Start the animation loop early so user sees something
            renderer.setAnimationLoop(animate);
            
            await loadModel();
            modelLoaded = true;
            
            // Load non-essential effects in the background
            setTimeout(() => loadEffects(), 100);
            
        } catch (error) {
            console.error('Error initializing scene:', error);
        }
    }

    async function setupRenderer() {
        return new Promise<void>((resolve) => {
            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Limit pixel ratio for performance
            renderer.setSize(window.innerWidth, window.innerHeight);
            (container as HTMLElement).appendChild(renderer.domElement);

            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 0.035;
            
            resolve();
        });
    }

    async function setupScene() {
        return new Promise<void>((resolve) => {
            scene = new THREE.Scene();
            // Set a simple background color initially
            scene.background = new THREE.Color(0x0a1929);
            resolve();
        });
    }

    async function setupCamera() {
        return new Promise<void>((resolve) => {
            camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 180);
            
            controls = new OrbitControls(camera, renderer.domElement);
            controls.minDistance = 2;
            controls.maxDistance = 10;
            controls.maxPolarAngle = Math.PI * 0.8;
            
            // Old angel camera settings (restored for Lucy)
            camera.position.set(3.30, -0.45, 4.66);
            controls.target.set(-0.12, 0.88, 1.16);
            
            // Lucy camera settings (alternative positioning)
            // camera.position.set(lucyCameraPosition.x, lucyCameraPosition.y, lucyCameraPosition.z);
            // controls.target.set(lucyCameraTarget.x, lucyCameraTarget.y, lucyCameraTarget.z);
            
            // Check URL parameters for controls
            const urlParams = new URLSearchParams(window.location.search);
            const controlsParam = urlParams.get('controls');
            
            if (controlsParam === 'true') {
                controls.enableRotate = true;
                controls.enablePan = true;
                controls.enableZoom = true;
                controlsEnabled = true;
            } else {
                controls.enableRotate = false;
                controls.enablePan = false;
                controls.enableZoom = false;
                controlsEnabled = false;
            }
            
            controls.update();
            resolve();
        });
    }

    async function setupLighting() {
        return new Promise<void>((resolve) => {
            const loader = new THREE.TextureLoader();
            const disturbTexture = loader.load('/textures/disturb.jpg');
            disturbTexture.minFilter = THREE.LinearFilter;  
            disturbTexture.magFilter = THREE.LinearFilter;
            disturbTexture.generateMipmaps = false;
            disturbTexture.colorSpace = THREE.SRGBColorSpace;

            spotLight = new THREE.SpotLight(0xffffff, 1000);
            spotLight.position.set(2.5, 8, 2.5); // @ts-ignore: exists
            spotLight.angle = Math.PI / 10; // @ts-ignore: exists
            spotLight.penumbra = 0; // @ts-ignore: exists
            spotLight.decay = 1.5; // @ts-ignore: exists
            spotLight.distance = 0; // @ts-ignore: exists
            spotLight.map = disturbTexture;
            
            // Point the spotlight at the model
            spotLight.target.position.set(0, 0.65, 0);
            scene.add(spotLight.target);

            spotLight.castShadow = true; // @ts-ignore: exists
            spotLight.shadow.mapSize.width = 512; // @ts-ignore: exists
            spotLight.shadow.mapSize.height = 512; // @ts-ignore: exists
            spotLight.shadow.camera.near = 2; // @ts-ignore: exists
            spotLight.shadow.camera.far = 10; // @ts-ignore: exists
            spotLight.shadow.focus = 0.75; 
            spotLight.shadow.bias = -0.001; // @ts-ignore: exists
            scene.add(spotLight);

            // Use HemisphereLight like the example instead of AmbientLight
            const ambient = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.1);
            scene.add(ambient);
            
            resolve();
        });
    }

    async function loadModel() {
        return new Promise<void>((resolve) => {
            new GLTFLoader().load('/models/lucy.glb', function (gltf) {
                const model = gltf.scene;

                // Rotate model to stand upright and face the camera
                model.rotation.x = Math.PI / 2; // Rotate 90 degrees to stand up
                model.rotation.z = Math.PI; // Rotate 180 degrees around Z-axis to face opposite direction
                
                // Scale down significantly to fit the scene (2x larger than before)
                model.scale.set(0.0026, 0.0026, 0.0026);
                
                // Position at origin, raised up half a unit
                model.position.set(0, 0.5, 0);
                
                model.traverse(function (child) { // @ts-ignore: exists
                    if (child.isMesh) {
                        child.castShadow = true;
                        child.receiveShadow = true;
                        
                        // Recompute normals for better lighting
                        if (child.geometry) {
                            child.geometry.computeVertexNormals();
                        }
                        
                        // Replace material with MeshPhongMaterial for shininess
                        if (child.material) {
                            const oldMaterial = child.material;
                            child.material = new THREE.MeshPhongMaterial({
                                color: oldMaterial.color || 0xffffff,
                                shininess: 400,  // Higher = shinier (default is 30)
                                specular: 0xeeeeee,  // Specular highlight color (brighter = shinier)
                            });
                            child.material.needsUpdate = true;
                        }
                    }
                });
                
                scene.add(model);
                
                resolve();
            }, 
            (progress) => {
                // Optional: Handle progress if needed
            },
            (error) => {
                console.error('Error loading model:', error);
                resolve(); // Continue even if model fails to load
            });
        });
    }

    async function loadEffects() {
        try {
            // Load sky and stars
            await createSkyAndStars();
            
            // Setup post-processing
            await setupPostProcessing();
            
            // Create volumetric fog last (most expensive)
            await createVolumetricFog();
            
            effectsLoaded = true;
            sceneReady = true;
            
            // Hide splash screen with a fade transition
            setTimeout(() => {
                showSplash = false;
                setupEventListeners(); // Setup event listeners after everything is loaded
            }, 200);
            
        } catch (error) {
            console.error('Error loading effects:', error);
            effectsLoaded = true; // Continue anyway
            sceneReady = true;
            setTimeout(() => {
                showSplash = false;
                setupEventListeners();
            }, 200);
        }
    }

    async function setupPostProcessing() {
        return new Promise<void>((resolve) => {
            composer = new EffectComposer(renderer);
            
            const renderPass = new RenderPass(scene, camera);
            composer.addPass(renderPass);
            
            const bloomPass = new UnrealBloomPass(
                new THREE.Vector2(window.innerWidth, window.innerHeight),
                0.2,    // strength
                0.75,    // radius
                5  // threshold
            );
            composer.addPass(bloomPass);
            
            resolve();
        });
    }

    // Setup event listeners after core scene is loaded
    function setupEventListeners() {
        // Detect if device is mobile
        isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        // Request device orientation permission for iOS 13+
        if (isMobile && typeof DeviceOrientationEvent !== 'undefined' && typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
            // For iOS 13+ devices, we need to request permission
            // This will be triggered by user interaction later
        } else if (isMobile) {
            // For other mobile devices, set up orientation listener immediately
            setupOrientationListener();
        }

        // Window resize handler
        window.addEventListener('resize', onWindowResize);
        
        // Mouse movement handler for subtle camera movement (only when controls are disabled)
        window.addEventListener('mousemove', (event) => {
            if (!controlsEnabled && !isMobile) {
                // Normalize mouse position to -1 to 1 range
                mouseX = (event.clientX / window.innerWidth) * 2 - 1;
                mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
                
                // Update vignette position with smoothing
                vignetteX = (event.clientX / window.innerWidth - 0.5) * 20; // Range: -10 to 10
                vignetteY = (event.clientY / window.innerHeight - 0.5) * 20; // Range: -10 to 10
            }
        });
        
        // Touch handler for mobile to request orientation permission
        window.addEventListener('touchstart', async (event) => {
            if (isMobile && !hasOrientationPermission && typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
                try {
                    const permission = await (DeviceOrientationEvent as any).requestPermission();
                    if (permission === 'granted') {
                        hasOrientationPermission = true;
                        setupOrientationListener();
                    }
                } catch (error) {
                    console.log('Orientation permission denied');
                }
            }
        }, { once: true });
        
        // Camera position logger (press 'C' key)
        window.addEventListener('keydown', (event) => {
            if (event.key === 'c' || event.key === 'C') {
                console.log('=== CAMERA POSITION ===');
                console.log(`camera.position.set(${camera.position.x.toFixed(2)}, ${camera.position.y.toFixed(2)}, ${camera.position.z.toFixed(2)});`);
                console.log(`controls.target.set(${controls.target.x.toFixed(2)}, ${controls.target.y.toFixed(2)}, ${controls.target.z.toFixed(2)});`);
                console.log('======================');
            }
            
            // WASD controls
            const key = event.key.toLowerCase();
            if (key === 'w') keys.w = true;
            if (key === 'a') keys.a = true;
            if (key === 's') keys.s = true;
            if (key === 'd') keys.d = true;
            if (key === 'q') keys.q = true;
            if (key === 'e') keys.e = true;
            if (event.shiftKey) keys.shift = true;
        });
        
        window.addEventListener('keyup', (event) => {
            const key = event.key.toLowerCase();
            if (key === 'w') keys.w = false;
            if (key === 'a') keys.a = false;
            if (key === 's') keys.s = false;
            if (key === 'd') keys.d = false;
            if (key === 'q') keys.q = false;
            if (key === 'e') keys.e = false;
            if (!event.shiftKey) keys.shift = false;
        });
    }

    function setupOrientationListener() {
        let isCalibrated = false;
        
        window.addEventListener('deviceorientation', (event) => {
            if (!controlsEnabled && isMobile) {
                // Calibrate on first reading
                if (!isCalibrated && event.beta !== null && event.gamma !== null) {
                    initialOrientation.beta = event.beta;
                    initialOrientation.gamma = event.gamma;
                    isCalibrated = true;
                    return;
                }
                
                if (event.beta !== null && event.gamma !== null && isCalibrated) {
                    // Calculate relative rotation from initial position
                    const deltaBeta = event.beta - initialOrientation.beta;  // Forward/backward tilt
                    const deltaGamma = event.gamma - initialOrientation.gamma; // Left/right tilt
                    
                    // Convert to normalized coordinates (-1 to 1)
                    // Limit the range to prevent extreme movements
                    mouseX = Math.max(-1, Math.min(1, deltaGamma / 30)); // 30 degrees = full range
                    mouseY = Math.max(-1, Math.min(1, deltaBeta / 30));  // 30 degrees = full range
                    
                    // Update vignette position
                    vignetteX = mouseX * 10;
                    vignetteY = mouseY * 10;
                }
            }
        });
    }

    function handleScroll() {
        if (!scrollContainer) return; // @ts-ignore: exists
        const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
        const scrollableHeight = scrollHeight - clientHeight;
        
        if (scrollableHeight > 0) {
            const scrollPercentage = scrollTop / scrollableHeight;
            
            // Convert scroll to camera rotation (0 to 2π for full circle) - negative for opposite direction
            targetScrollAngle = -scrollPercentage * Math.PI * 2;
        }
    }

    function onWindowResize() { // @ts-ignore: exists
        camera.aspect = window.innerWidth / window.innerHeight; // @ts-ignore: exists
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
    }

    function createSkyAndStars() {
        return new Promise<void>((resolve) => {
            // Remove the simple background color
            scene.background = null;
            
            // Create gradient sky sphere
            const skyGeometry = new THREE.SphereGeometry(90, 32, 16);
            
            // Create gradient material
            const skyMaterial = new THREE.ShaderMaterial({
                vertexShader: /* glsl */`
                    varying vec3 vWorldPosition;
                    void main() {
                        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                        vWorldPosition = worldPosition.xyz;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: /* glsl */`
                    varying vec3 vWorldPosition;
                    void main() {
                        float h = normalize(vWorldPosition).y;
                        // Create gradient from brighter blue at horizon to dark blue at zenith
                        vec3 bottomColor = vec3(0.15, 0.25, 0.4); // Brighter blue
                        vec3 topColor = vec3(0, 0.4, 0.5); // Dark blue instead of black
                        float gradient = smoothstep(-0.02, 0.5, h);
                        gl_FragColor = vec4(mix(bottomColor, topColor, gradient), 1.0);
                    }
                `,
                side: THREE.BackSide
            });
            
            skyMesh = new THREE.Mesh(skyGeometry, skyMaterial);
            scene.add(skyMesh);
            
            // Create stars with reduced count for better performance
            const starGeometry = new THREE.BufferGeometry();
            const starCount = 512; // Reduced from 1024
            const positions = new Float32Array(starCount * 3);
            
            for (let i = 0; i < starCount; i++) {
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.random() * Math.PI;
                const radius = 20;
                
                positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
                positions[i * 3 + 1] = radius * Math.cos(phi);
                positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
            }
            
            starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            
            const starMaterial = new THREE.PointsMaterial({
                color: 0xaaddff,
                size: 2,
                vertexColors: false,
                transparent: true,
                opacity: 10,
                sizeAttenuation: false
            });
            
            stars = new THREE.Points(starGeometry, starMaterial);
            scene.add(stars);
            
            resolve();
        });
    }

    function createVolumetricFog() {
        return new Promise<void>((resolve) => {
            // Use smaller texture for better performance
            const size = 24; // Reduced from 32
            const data = new Uint8Array(size * size * size);

            let i = 0;
            const scale = 0.8;
            const perlin = new ImprovedNoise();
            const vector = new THREE.Vector3();

            for (let z = 0; z < size; z++) {
                for (let y = 0; y < size; y++) {
                    for (let x = 0; x < size; x++) {
                        const d = 1.0 - vector.set(x, y, z).subScalar(size / 2).divideScalar(size).length();
                        data[i] = (180 + 180 * perlin.noise(x * scale / 1.5, y * scale, z * scale / 1.5)) * d * d;
                        i++;
                    }
                }
            }

            const texture = new THREE.Data3DTexture(data, size, size, size);
            texture.format = THREE.RedFormat;
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.unpackAlignment = 1;
            texture.needsUpdate = true;

        const vertexShader = /* glsl */`
            in vec3 position;

            uniform mat4 modelMatrix;
            uniform mat4 modelViewMatrix;
            uniform mat4 projectionMatrix;
            uniform vec3 cameraPos;

            out vec3 vOrigin;
            out vec3 vDirection;

            void main() {
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

                vOrigin = vec3(inverse(modelMatrix) * vec4(cameraPos, 1.0)).xyz;
                vDirection = position - vOrigin;

                gl_Position = projectionMatrix * mvPosition;
            }
        `;

        const fragmentShader = /* glsl */`
            precision highp float;
            precision highp sampler3D;

            in vec3 vOrigin;
            in vec3 vDirection;

            out vec4 color;

            uniform vec3 base;
            uniform sampler3D map;
            uniform float threshold;
            uniform float range;
            uniform float opacity;
            uniform float steps;
            uniform float frame;
            uniform vec3 cameraPos;
            uniform vec3 spotLightPos;

            uint wang_hash(uint seed) {
                seed = (seed ^ 61u) ^ (seed >> 16u);
                seed *= 9u;
                seed = seed ^ (seed >> 4u);
                seed *= 0x27d4eb2du;
                seed = seed ^ (seed >> 15u);
                return seed;
            }

            float randomFloat(inout uint seed) {
                return float(wang_hash(seed)) / 4294967296.;
            }

            vec2 hitBox(vec3 orig, vec3 dir) {
                const vec3 box_min = vec3(-0.5);
                const vec3 box_max = vec3(0.5);
                vec3 inv_dir = 1.0 / dir;
                vec3 tmin_tmp = (box_min - orig) * inv_dir;
                vec3 tmax_tmp = (box_max - orig) * inv_dir;
                vec3 tmin = min(tmin_tmp, tmax_tmp);
                vec3 tmax = max(tmin_tmp, tmax_tmp);
                float t0 = max(tmin.x, max(tmin.y, tmin.z));
                float t1 = min(tmax.x, min(tmax.y, tmax.z));
                return vec2(t0, t1);
            }

            float sample1(vec3 p) {
                return texture(map, p).r;
            }

            float shading(vec3 coord) {
                float step = 0.01;
                return sample1(coord + vec3(-step)) - sample1(coord + vec3(step));
            }

            void main() {
                vec3 rayDir = normalize(vDirection);
                vec2 bounds = hitBox(vOrigin, rayDir);

                if (bounds.x > bounds.y) discard;

                // Ensure we always have some ray distance even when looking head-on
                bounds.x = max(bounds.x, 0.0);
                float rayLength = bounds.y - bounds.x;
                if (rayLength < 0.01) rayLength = 0.01; // Minimum ray length

                vec3 p = vOrigin + bounds.x * rayDir;
                vec3 inc = 1.0 / abs(rayDir);
                float delta = min(inc.x, min(inc.y, inc.z));
                delta /= steps;
                delta = max(delta, rayLength / steps); // Ensure proper step size

                // Jitter
                uint seed = uint(gl_FragCoord.x) * uint(1973) + uint(gl_FragCoord.y) * uint(9277) + uint(frame) * uint(26699);
                vec3 size = vec3(textureSize(map, 0));
                float randNum = randomFloat(seed) * 2.0 - 1.0;
                p += rayDir * randNum * (1.0 / size);

                vec4 ac = vec4(base, 0.0);

                for (float t = bounds.x; t < bounds.y; t += delta) {
                    float d = sample1(p + 0.5);

                    d = smoothstep(threshold - range, threshold + range, d) * opacity;

                    float col = shading(p + 0.5) * 3.0 + ((p.x + p.y) * 0.25) + 0.2;

                    // Boost visibility for short rays (front-facing views)
                    float rayLengthBoost = 1.0 + (1.0 - rayLength) * 2.0;
                    
                    // Add consistent base visibility regardless of lighting angle
                    float baseVisibility = 0.8; // Always visible base amount
                    d = d * rayLengthBoost + baseVisibility * d;

                    ac.rgb += (1.0 - ac.a) * d * col;
                    ac.a += (1.0 - ac.a) * d;

                    if (ac.a >= 0.95) break;

                    p += rayDir * delta;
                }

                color = ac;
                if (color.a == 0.0) discard;
            }
        `;

        const geometry = new THREE.BoxGeometry(1, 1, 1);  // Standard unit cube
        const material = new THREE.RawShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: {
                base: { value: new THREE.Color(0xffffff) }, // Bright white for low exposure
                map: { value: texture },
                cameraPos: { value: new THREE.Vector3() },
                spotLightPos: { value: new THREE.Vector3() }, // Add spotlight position
                threshold: { value: 0.4 },  
                opacity: { value: 0.8 },    
                range: { value: 0.15 },     
                steps: { value: 6 },       // Reduced from 8 for better performance
                frame: { value: 0 }
            },
            vertexShader,
            fragmentShader,
            side: THREE.DoubleSide,  // Render both front and back faces
            transparent: true,
            depthWrite: false        // Don't write to depth buffer for better blending
        });

        volumetricMesh = new THREE.Mesh(geometry, material);
        volumetricMesh.scale.set(7.5, 4, 7.5);  // Scale the mesh in world space
        volumetricMesh.position.set(0, -1.45, 0); // Position closer to statue level
        scene.add(volumetricMesh);
        
        resolve();
    }
        )};

    function animate() {
        if (!coreSceneLoaded) return; // Don't animate until core scene is loaded
        
        const deltaTime = 1 / 60; // Assume 60 FPS for consistent speed
        const baseSpeed = 0.25; // Base rotation speed
        
        // Normalize angle to 0-2π range
        const normalizedAngle = accumulatedAngle % (Math.PI * 2);
        
        // Check if we're in the "behind" zone (π/2 to 3π/2 = 90° to 270°)
        const speedMultiplier = (normalizedAngle > Math.PI * 1 && normalizedAngle < Math.PI * 1.55) ? 1.75 : 1.0;
        
        accumulatedAngle += baseSpeed * speedMultiplier * deltaTime;
        
        if (spotLight) {
            spotLight.position.x = Math.cos(accumulatedAngle) * 2.5;
            spotLight.position.z = Math.sin(accumulatedAngle) * 2.5;
        }

        // Only update volumetric fog if it's loaded
        if (volumetricMesh && camera) {
            volumetricMesh.material.uniforms.cameraPos.value.copy(camera.position);
            if (spotLight) {
                volumetricMesh.material.uniforms.spotLightPos.value.copy(spotLight.position);
            }
            volumetricMesh.material.uniforms.frame.value++;
        }

        // Only animate stars if they're loaded
        if (stars) {
            const time = performance.now() * 0.000005; 
            stars.rotation.x = Math.PI / 6; 
            stars.rotation.y = time;
        }

        // Smooth interpolation for scroll angle
        const lerpFactor = 0.1; // Adjust for smoother/faster transitions
        scrollAngle = scrollAngle + (targetScrollAngle - scrollAngle) * lerpFactor;

        if (!controlsEnabled) {
            // Define the center point to orbit around (statue position at origin)
            const orbitCenter = { x: 0, y: 0, z: 0 }; // Statue is at 0,0,0
            
            // Calculate the initial offset from orbit center to starting camera position
            const initialOffset = {
                x: baseCameraPosition.x - orbitCenter.x,
                y: baseCameraPosition.y - orbitCenter.y,
                z: baseCameraPosition.z - orbitCenter.z
            };
            
            // Calculate radius from the initial position
            const radius = Math.sqrt(initialOffset.x * initialOffset.x + initialOffset.z * initialOffset.z);
            
            // Calculate the initial angle from the starting position
            const initialAngle = Math.atan2(initialOffset.z, initialOffset.x);
            
            // Apply scroll rotation on top of initial angle
            const currentAngle = initialAngle + scrollAngle;
            
            // Calculate scroll-based camera position (orbiting around the statue)
            const baseScrollX = orbitCenter.x + Math.cos(currentAngle) * radius;
            const baseScrollZ = orbitCenter.z + Math.sin(currentAngle) * radius;
            
            // Calculate scroll progress (0 to 1) for vertical movement and target adjustment
            const scrollProgress = Math.abs(scrollAngle) / (Math.PI * 2); // 0 to 1 for full rotation
            
            // Gradually move camera upward as you scroll
            const heightOffset = scrollProgress * 4.0; // Move up by 2 units at full scroll
            
            // Calculate the target offset from orbit center to original target
            const targetOffset = {
                x: baseCameraTarget.x - orbitCenter.x,
                y: baseCameraTarget.y - orbitCenter.y,
                z: baseCameraTarget.z - orbitCenter.z
            };
            
            // Calculate target radius (distance from statue to original target)
            const targetRadius = Math.sqrt(targetOffset.x * targetOffset.x + targetOffset.z * targetOffset.z);
            
            // Calculate the initial target angle
            const initialTargetAngle = Math.atan2(targetOffset.z, targetOffset.x);
            
            // Apply scroll rotation to target as well
            const currentTargetAngle = initialTargetAngle + scrollAngle;
            
            // Calculate scroll-based target position (orbiting around the statue)
            const baseScrollTargetX = orbitCenter.x + Math.cos(currentTargetAngle) * targetRadius;
            const baseScrollTargetZ = orbitCenter.z + Math.sin(currentTargetAngle) * targetRadius;
            
            // Gradually lower the target Y position as you scroll to look more downward
            const targetHeightOffset = -scrollProgress * -0.75; // Lower target by 0.8 units at full scroll
            
            // Apply mouse parallax on top of scroll position
            const parallaxStrength = 0.5; 
            camera.position.x = baseScrollX + mouseX * parallaxStrength;
            camera.position.y = baseCameraPosition.y + heightOffset + mouseY * parallaxStrength * 0.5;
            camera.position.z = baseScrollZ + mouseY * parallaxStrength * 0.3;
            
            // Apply parallax to target as well to maintain relationship
            controls.target.x = baseScrollTargetX + mouseX * parallaxStrength * 0.5;
            controls.target.y = baseCameraTarget.y + targetHeightOffset + mouseY * parallaxStrength * 0.3;
            controls.target.z = baseScrollTargetZ;
        }
        
        controls.update();

        // Use appropriate renderer based on what's loaded
        if (composer && effectsLoaded) {
            composer.render();
        } else {
            renderer.render(scene, camera);
        }
    }
</script>

<svelte:window on:resize={onWindowResize} />

<div class="relative w-full h-screen overflow-hidden bg-gray-900">
    <div bind:this={container} class="w-full h-full"></div>
    
    {#if showSplash}
        <div transition:fade="{{ duration: 175, delay: 0, easing: cubicOut }}" class="splash-screen absolute inset-0 z-25 flex items-center w-full h-full bg-black justify-center">
        </div>
    {/if}
    
    <div  class="absolute top-0 left-0 z-30 h-full w-full p-6 md:p-8 pointer-events-auto">
        <div bind:this={scrollContainer} onscroll={handleScroll} class="overflow-y-auto custom-scrollbar h-full w-full">
        <div class="pr-auto w-fit max-w-[80%] md:max-w-[50%] lg:max-w-[40%] bg-transparent bg-opacity-100 text-shadow-lg text-shadow-black  rounded-lg p-6 md:p-8 overflow-y-visible">
            <!-- <div class="pb-4">
                    <p class="font-['Rubik'] text-sm text-gray-300 font-bold">highlights: 40m software downloads,<br>65m human page views. xi jingping's<br>daughter used one of my sites</p>
            </div>-->
            
            <div class="w-full flex items-center gap-3 mb-4">
                <div class="flex-1 h-px bg-white"></div>
                <h3 class="text-gray-200 text-lg sm:text-xl font-black font-['AnyaTamy'] whitespace-nowrap px-2">find me online</h3>
                <div class="flex-1 h-px bg-white"></div>
            </div>
            <div class="flex items-center gap-4 md:gap-10 pb-2 pt-3 justify-center">
                <a 
                    href="https://github.com/a0a7" 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    class="flex items-center gap-2 text-gray-300 hover:text-gray-400 transition-colors duration-200 font-['Rubik'] text-sm"
                >
                    <img src="/icons/github-cat.svg" alt="GitHub" class="w-4 h-4 opacity-80" />
                    <span>github</span>
                </a>
                <a 
                    href="https://t.me/awa0a7" 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    class="flex items-center gap-2 text-gray-300 hover:text-gray-400 transition-colors duration-200 font-['Rubik'] text-sm"
                >
                    <img src="/icons/telegram.svg" alt="Telegram" class="w-4 h-4 opacity-80" />
                    <span>telegram</span>
                </a>
            </div>
            <div class="flex items-center gap-4 md:gap-10 pb-8 pt-4 justify-center">
                <button 
                    onclick={() => {
                        navigator.clipboard.writeText('a0@ieee.org');
                        emailCopied = true;
                        setTimeout(() => emailCopied = false, 800);
                    }}
                    class="flex items-center gap-2 text-gray-300 hover:text-gray-400 transition-colors duration-200 font-['Rubik'] text-sm cursor-pointer bg-transparent border-none relative"
                >
                    <span>a0@ieee.org</span>
                    {#if emailCopied}
                        <span class="absolute font-['Rubik'] -right-14 text-xs text-gray-400" transition:fade={{ duration: 50 }}>copied!</span>
                    {/if}
                </button>        
            </div>
            
            <div class="w-full flex items-center gap-3 mb-8">
                <div class="flex-1 h-px bg-white"></div>
                <h3 class="text-gray-200 text-lg sm:text-xl font-black font-['AnyaTamy'] whitespace-nowrap px-2">personal projects</h3>
                <div class="flex-1 h-px bg-white"></div>
            </div>                

            <div class="space-y-8">
                {#each data.projects as project, projectIndex}
                    {@const titleParts = project.title.split('//')}
                    {@const displayTitle = titleParts[0]}
                    {@const logoName = titleParts[1]}
                    <div class="relative pl-5 project-item ">
                        <div class="transform translate-y-[2px] absolute left-0 top-0 h-full">
                            {#if logoName}
                                <div class="absolute left-0 top-[5px] h-[calc(50%-22px)] w-0.5 bg-white opacity-60 rounded-[1px]"></div>
                                <div class="absolute left-0 bottom-[5px] h-[calc(50%-22px)] w-0.5 bg-white opacity-60 rounded-[1px]"></div>
                                <!-- Logo replaces diamond -->
                                <div class="absolute left-[-20px] top-1/2 transform -translate-y-1/2 translate-x-[11px]">
                                    <img 
                                        src="/icons/{logoName}.png" 
                                        alt={logoName} 
                                        class="w-6 h-6 opacity-70 object-contain invert" 
                                    />
                                </div>
                            {:else}
                                <!-- Default lines and diamond -->
                                <div class="absolute left-0 top-[5px] h-[calc(50%-22px)] w-0.5 bg-white opacity-60 rounded-[1px]"></div>
                                <div class="absolute left-0 bottom-[5px] h-[calc(50%-22px)] w-0.5 bg-white opacity-60 rounded-[1px]"></div>
                                <div class="absolute left-[-2.5px] top-1/2 transform -translate-y-1/2   w-2 h-2 bg-white opacity-60 rotate-45 rounded-[1px]"></div>
                            {/if}
                        </div>
                        
                        <div class="flex items-start">
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center">
                                    <h2 class="text-sm md:text-base text-gray-200 leading-5 tracking-tight font-['Rubik'] pr-[2px] font-medium transform scale-y-100">
                                        {#if project.urls && project.urls.length > 0}
                                            <a 
                                                href={project.urls[0].url} 
                                                target="_blank" 
                                                rel="noopener noreferrer" 
                                                class="project-title-link transition-opacity duration-75"
                                                onmouseenter={() => hoveredTitleIndex = projectIndex}
                                                onmouseleave={() => hoveredTitleIndex = -1}
                                                style="opacity: {hoveredTitleIndex === projectIndex || hoveredFirstIconIndex === projectIndex ? 0.6 : 1}"
                                            >
                                                {displayTitle}
                                            </a>
                                        {:else}
                                            {displayTitle}
                                        {/if}
                                    </h2>
                                    {#if project.urls && project.urls.length > 0}
                                        <div class="flex items-center">
                                            {#each project.urls as urlData, index}
                                                <a 
                                                    href={urlData.url} 
                                                    target="_blank" 
                                                    rel="noopener noreferrer" 
                                                    class="text-gray-200 transition-opacity relative inline-block transform -translate-y-[3px]"
                                                    onmouseenter={() => {
                                                        if (index === 0) hoveredFirstIconIndex = projectIndex;
                                                        hoveredIconIndex = `${projectIndex}-${index}`;
                                                    }}
                                                    onmouseleave={() => {
                                                        if (index === 0) hoveredFirstIconIndex = -1;
                                                        hoveredIconIndex = null;
                                                    }}
                                                    style="opacity: {
                                                        index === 0 ? 
                                                            (hoveredTitleIndex === projectIndex || hoveredFirstIconIndex === projectIndex ? 0.6 : 1) :
                                                            (hoveredIconIndex === `${projectIndex}-${index}` ? 0.6 : 1)
                                                    }"
                                                >
                                                    <img src="/icons/{urlData.icon}.svg" alt={urlData.icon} class="w-4 h-4 invert mx-[6px]" />
                                                    <svg class="absolute -top-px right-[3px] w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                                        <path d="M7 17L17 7M17 7H8M17 7V16" stroke="#261e29" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
                                                        <path d="M7 17L17 7M17 7H8M17 7V16" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
                                                    </svg>
                                                </a>
                                            {/each}
                                        </div>
                                    {/if}
                                </div>
                                <p class="text-gray-300 leading-relaxed tracking-tighter font-['Rubik']">{project.description}</p>
                                <div class="flex items-center gap-3 text-sm tracking-tight text-gray-400 font-['Rubik']">
                                    <span class="tech">{project.date}</span>
                                    <span class="text-xs">◆</span>
                                    <div class="date">{project.tech}</div>
                                    {#if project.views}
                                        <span class="text-xs">◆</span>
                                        <div class="views transform -translate-x-1">
                                            <svg class="transform -translate-x-0.5" xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="M607.5-372.5Q660-425 660-500t-52.5-127.5Q555-680 480-680t-127.5 52.5Q300-575 300-500t52.5 127.5Q405-320 480-320t127.5-52.5Zm-204-51Q372-455 372-500t31.5-76.5Q435-608 480-608t76.5 31.5Q588-545 588-500t-31.5 76.5Q525-392 480-392t-76.5-31.5ZM214-281.5Q94-363 40-500q54-137 174-218.5T480-800q146 0 266 81.5T920-500q-54 137-174 218.5T480-200q-146 0-266-81.5ZM480-500Zm207.5 160.5Q782-399 832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280q113 0 207.5-59.5Z"/></svg>
                                            {project.views}
                                        </div>
                                    {/if}
                                    {#if project.downloads}
                                        <span class="text-xs">◆</span>
                                        <div class="downloads transform -translate-x-1">
                                            <svg  xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg>
                                            {project.downloads}
                                        </div>
                                    {/if}
                                </div>
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    </div>
    </div>
    
    <div 
        class="vignette-overlay"
        style="--vignette-x: {vignetteX}px; --vignette-y: {vignetteY}px;"
    ></div>
</div>

<style>

    :global(body) {
        margin: 0;
        padding: 0;
        overflow: hidden;
    }
    
    .custom-scrollbar {
        /* Hide default scrollbar */
        scrollbar-width: none; /* Firefox */
        -ms-overflow-style: none; /* Internet Explorer 10+ */
    }
    
    .custom-scrollbar::-webkit-scrollbar {
        display: none; /* WebKit */
    }
    
    /* Custom scrollbar on the left */
    .custom-scrollbar {
        position: relative;
    }
    
    .vignette-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        background: radial-gradient(
            ellipse 60% 50% at calc(50% + var(--vignette-x, 0px)) calc(50% + var(--vignette-y, 0px)),
            transparent 20%,
            rgba(0, 0, 0, 0.1) 40%,
            rgba(0, 0, 0, 0.3) 70%,
            rgba(0, 0, 0, 0.6) 100%
        );
        backdrop-filter: blur(0.5px);
        transition: all 0.1s ease-out;
        z-index: 10;
    }

    .splash-screen {
        transition: opacity 0.5s ease-in-out;
    }

    .downloads, .views {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        font-size: 1em;
    }

    .downloads svg, .views svg {
        opacity: 0.8;
    }

    .tech {
        font-size: 1em;
    }
</style>