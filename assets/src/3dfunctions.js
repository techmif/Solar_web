// Basic Three.js helper that depends on global `THREE` (UMD build)
// Exposes window.initThree(containerSelector, opts) which returns an object { renderer, scene, camera, mesh, stop }

(function () {
  function initThree(containerSelector = '#three-container', opts = {}) {
    if (typeof THREE === 'undefined') {
      console.error('THREE is not available. Make sure three.min.js is loaded before this script.');
      return null;
    }

    const container = document.querySelector(containerSelector) || document.body;
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || Math.round(window.innerHeight * 0.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(width, height);
    renderer.setClearColor(opts.clearColor || 0x111111);
    // ensure correct color space for textures (r150+ uses outputColorSpace)
    try {
      if ('outputColorSpace' in renderer && THREE && THREE.SRGBColorSpace !== undefined) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      } else if ('outputEncoding' in renderer && THREE && THREE.sRGBEncoding !== undefined) {
        renderer.outputEncoding = THREE.sRGBEncoding;
      }
    } catch (e) {}

    // ensure container is empty of previous canvas
    while (container.firstChild) container.removeChild(container.firstChild);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 0, opts.cameraZ || 3);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(5, 10, 7.5);
    scene.add(dir);

    // default geometry: a sphere to represent a planet (will be replaced if a model is provided)
    const geometry = new THREE.SphereGeometry(opts.radius || 0.9, 32, 32);
    const material = new THREE.MeshStandardMaterial({ color: opts.color || 0x8888ff, metalness: 0.1, roughness: 0.7 });
    let currentModel = new THREE.Mesh(geometry, material);
    scene.add(currentModel);

    let running = true;

    function onResize() {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || Math.max(200, Math.round(window.innerHeight * 0.5));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }

    window.addEventListener('resize', onResize);

    function animate() {
      if (!running) return;
      if (currentModel) {
        currentModel.rotation.y += opts.rotationSpeed || 0.005;
        currentModel.rotation.x += (opts.rotationXSpeed || 0) * 0.001;
      }
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);

    function stop() {
      running = false;
      try {
        window.removeEventListener('resize', onResize);
        if (renderer && renderer.domElement && renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
        renderer.dispose && renderer.dispose();
      } catch (e) {
        // swallow cleanup errors
      }
    }

    // model loader utility: supports FBX (if FBXLoader is available) and will apply a texture if provided
    async function loadModel(modelPath, texturePath, modelOpts = {}) {
      if (!modelPath) return Promise.reject(new Error('modelPath required'));

      // helper to dynamically load FBXLoader if not present
      async function ensureFBXLoader() {
        if (typeof THREE.FBXLoader !== 'undefined' || typeof FBXLoader !== 'undefined') return;
        const urls = [
          'https://unpkg.com/three@0.155.0/examples/js/loaders/FBXLoader.js',
          'https://cdn.jsdelivr.net/npm/three@0.155.0/examples/js/loaders/FBXLoader.js'
        ];
        for (const url of urls) {
          await new Promise((resolve) => {
            const s = document.createElement('script');
            s.src = url;
            s.async = true;
            s.onload = () => { console.log('Loaded FBXLoader script from', url); resolve(true); };
            s.onerror = () => { console.warn('Failed to load FBXLoader from', url); resolve(false); };
            document.head.appendChild(s);
          });
          if (typeof THREE.FBXLoader !== 'undefined' || typeof FBXLoader !== 'undefined') return;
        }
        // final check: if still not available, give up after short delay
        await new Promise((res) => setTimeout(res, 300));
      }

      // helper to apply a texture to all mesh materials
      function applyTextureToObject(obj, texture) {
        // set texture color space in a backwards-compatible way
        try {
          if (texture) {
            if ('colorSpace' in texture && THREE && THREE.SRGBColorSpace !== undefined) texture.colorSpace = THREE.SRGBColorSpace;
            else if ('encoding' in texture && THREE && THREE.sRGBEncoding !== undefined) texture.encoding = THREE.sRGBEncoding;
          }
        } catch (e) {}

        obj.traverse((child) => {
          if (child.isMesh) {
            if (child.material) {
              child.material.map = texture;
              try {
                child.material.side = THREE.DoubleSide;
              } catch (e) {}
              child.material.needsUpdate = true;
            }
          }
        });
      }

      // remove previous model from scene
      try {
        if (currentModel) scene.remove(currentModel);
      } catch (e) {}

      // load texture first (if provided)
      let tex = null;
      if (texturePath) {
        try {
          tex = await new Promise((resolve, reject) => {
            new THREE.TextureLoader().load(encodeURI(texturePath), resolve, undefined, reject);
          });
          // set texture color space with backward-compatible property names
          try {
            if (tex) {
              if ('colorSpace' in tex && THREE && THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
              else if ('encoding' in tex && THREE && THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding;
            }
          } catch (e) {}
        } catch (e) {
          console.warn('Texture load failed', texturePath, e);
          tex = null;
        }
      }

      // choose loader by extension
      const ext = (modelPath.split('.').pop() || '').toLowerCase();

      if (ext === 'fbx') {
        // ensure FBXLoader is available; try to load it dynamically if missing
        if (typeof THREE.FBXLoader === 'undefined' && typeof FBXLoader === 'undefined') {
          try {
            await ensureFBXLoader();
          } catch (e) {
            console.warn('Could not dynamically load FBXLoader', e);
          }
        }
        if (typeof THREE.FBXLoader === 'undefined' && typeof FBXLoader === 'undefined') {
          return Promise.reject(new Error('FBXLoader is not available. Ensure the FBXLoader script is included.'));
        }
        const Loader = THREE.FBXLoader || FBXLoader;
        return new Promise((resolve, reject) => {
          const loader = new Loader();
          loader.load(encodeURI(modelPath), (obj) => {
            try {
              // center and scale if requested
              if (modelOpts.scale) obj.scale.setScalar(modelOpts.scale);
              if (tex) applyTextureToObject(obj, tex);
              currentModel = obj;
              scene.add(currentModel);

              // compute bounding box and adjust camera to fit model
              try {
                const box = new THREE.Box3().setFromObject(currentModel);
                const size = box.getSize(new THREE.Vector3());
                const center = box.getCenter(new THREE.Vector3());
                const maxDim = Math.max(size.x, size.y, size.z);
                const fov = camera.fov * (Math.PI / 180);
                let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
                cameraZ *= 1.5; // add some spacing
                camera.position.set(center.x, center.y, center.z + cameraZ);
                camera.lookAt(center);
                camera.updateProjectionMatrix();
              } catch (e) {
                // ignore bbox errors
                console.warn('Could not compute bounding box for model', e);
              }

              console.log('FBX loaded:', modelPath);
              resolve(currentModel);
            } catch (e) {
              reject(e);
            }
          }, (xhr) => {
            // progress
            if (xhr && xhr.loaded && xhr.total) {
              const pct = Math.round((xhr.loaded / xhr.total) * 100);
              console.log(`FBXLoader progress: ${pct}%`);
            }
          }, (err) => {
            console.error('FBXLoader error', err);
            reject(err);
          });
        });
      }

      // fallback: try GLTFLoader if present
      if (typeof THREE.GLTFLoader !== 'undefined' || typeof GLTFLoader !== 'undefined') {
        const Loader = THREE.GLTFLoader || GLTFLoader;
        return new Promise((resolve, reject) => {
          const loader = new Loader();
          loader.load(modelPath, (gltf) => {
            const obj = gltf.scene || gltf.scenes?.[0] || gltf;
            if (modelOpts.scale) obj.scale.setScalar(modelOpts.scale);
            if (tex) applyTextureToObject(obj, tex);
            currentModel = obj;
            scene.add(currentModel);
            resolve(currentModel);
          }, undefined, reject);
        });
      }

      return Promise.reject(new Error('No suitable loader found for model: ' + modelPath));
    }

    return { renderer, scene, camera, mesh: currentModel, loadModel, stop };
  }

  // expose helper
  window.initThree = initThree;
})();
