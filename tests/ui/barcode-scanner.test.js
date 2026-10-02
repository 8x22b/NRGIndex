const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../../public/cabinet.js"), "utf8");

test("preview: TrueMark fields, proxy, full marking code and stale image guards", async () => {
  const elements = {};
  let imageResolve;
  let imageReject;
  let imageUrl;
  const raw = "0104680036912629215JuVJmTnOR:3H\x1D93kjJw";
  const data = { code: "4680036912629", rawCode: raw, product: { source: "truemark", name: "Energy", brand: "Brand", flavor: "Манго", image: "https://example.com/can.jpg" } };
  const sandbox = {
    barcodeBusy: false, autoScanGen: 1, camera: { mode: "code" }, pending: {},
    $: (id) => elements[id] ||= { open: true },
    api: async () => data, setCameraStatus() {}, renderSimilar() {}, showDupAck() {}, showPreview() {}, refreshPhotos() {}, updatePreviewImage() {},
    proxiedPhotoUrl: (url) => `api/cabinet/ai/photo-proxy?url=${encodeURIComponent(url)}`,
    processImageUrl: (url) => { imageUrl = url; return new Promise((resolve, reject) => { imageResolve = resolve; imageReject = reject; }); },
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(source.indexOf("  const barcodeNote ="), source.indexOf("  // Форматы, которые реально")) + "\nthis.lookup = lookupBarcode;", sandbox);
  await sandbox.lookup(raw);
  assert.equal(sandbox.pending.barcode, data.code);
  assert.equal(sandbox.pending.rawCode, raw);
  assert.equal(sandbox.pending.parsed.name, "Energy");
  assert.equal(sandbox.pending.parsed.brand, "Brand");
  assert.equal(sandbox.pending.parsed.flavor, "Манго");
  assert.match(imageUrl, /^api\/cabinet\/ai\/photo-proxy\?url=/);
  imageResolve("data:image/png;base64,ok");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sandbox.pending.image, "data:image/png;base64,ok");
  assert.equal(sandbox.pending.photoNote, "фото TrueMark ✓");
  await sandbox.lookup(raw);
  sandbox.pending.photoSource = "camera";
  sandbox.pending.photoNote = "моё фото";
  imageReject(new Error("stale"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sandbox.pending.photoNote, "моё фото");
  await sandbox.lookup(raw);
  sandbox.pending.barcode = "other";
  sandbox.pending.image = "new selection";
  imageResolve("old image");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sandbox.pending.image, "new selection");
  data.product.name = "Полное название ".repeat(20);
  await sandbox.lookup(raw);
  assert.equal(sandbox.pending.parsed.name, "");
  assert.ok(elements["smart-status"].textContent.includes(data.product.name));
});

test("scanner: bounded full frame/ROI variants keep edge coverage", () => {
  const draws = [];
  const context = {
    drawImage: (...args) => draws.push(args),
    getImageData: () => ({ data: new Uint8ClampedArray([40, 40, 40, 255]) }),
    putImageData: () => {},
  };
  const sandbox = { document: { createElement: () => ({ getContext: () => context }) } };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(source.indexOf("  const scanVariant ="), source.indexOf("  // Живой скан:")) + "\nthis.variant = scanVariant;", sandbox);
  for (let index = 0; index < 6; index++) {
    const canvas = sandbox.variant({ videoWidth: 3840, videoHeight: 2160 }, index);
    assert.ok(canvas.width <= 1280 && canvas.height <= 1280);
    const draw = draws.at(-1);
    assert.equal(draw[1], index % 2 ? 960 : 0);
    assert.equal(draw[3], index % 2 ? 1920 : 3840);
  }
});

test("scanner: older async start cannot schedule a stale loop", async () => {
  const pending = [];
  const timers = [];
  const sandbox = {
    camera: { mode: "code" },
    $: () => ({ open: true }),
    barcodeFormats: () => new Promise((resolve) => pending.push(resolve)),
    window: { BarcodeDetector: class {} },
    setCameraStatus: () => {},
    setTimeout: (fn) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    NATIVE_GRACE_MS: 2500,
  };
  vm.createContext(sandbox);
  const stop = source.slice(source.indexOf("  let autoScanTimer"), source.indexOf("  const NATIVE_GRACE_MS"));
  const start = source.slice(source.indexOf("  const startAutoScan ="), source.indexOf("  const stopCamera ="));
  vm.runInContext(stop + start + "\nthis.start = startAutoScan; this.stop = stopAutoScan;", sandbox);
  const older = sandbox.start();
  const newer = sandbox.start();
  pending[0](["data_matrix"]);
  await older;
  assert.equal(timers.length, 0);
  pending[1](["data_matrix"]);
  await newer;
  assert.equal(timers.length, 1);
  sandbox.stop();
  await timers[0](); // Must return before touching camera/video or decoding.
  assert.equal(timers.length, 1);
});

test("scanner: empty manual input keeps scanning; gallery failure offers retry, stale completion does not", async () => {
  const handlers = {};
  const elements = {};
  const sandbox = {
    camera: { mode: "code", busy: false }, barcodeBusy: false, autoScanGen: 0,
    $: (id) => elements[id] ||= { open: true, value: "", hidden: true, addEventListener: (event, fn) => { handlers[id] = fn; } },
    setCameraStatus: () => {},
    createImageBitmap: async () => ({ close() {} }),
    detectBarcode: async () => "",
    barcodeImageDataUrl: async () => "image",
    api: async () => ({ found: false }),
    lookupBarcode: async () => false,
    closeCamera: () => { elements["camera-dialog"].open = false; },
  };
  sandbox.stopAutoScan = () => { sandbox.autoScanGen++; };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(source.indexOf('  $("camera-file").addEventListener'), source.indexOf('  $("camera-torch").onclick')), sandbox);
  const enter = () => handlers["camera-code"]({ key: "Enter", preventDefault() {} });
  await enter();
  assert.equal(sandbox.autoScanGen, 0);
  elements["camera-code"].value = "123";
  await enter();
  assert.equal(elements["btn-camera-shoot"].hidden, false);
  const gallery = () => handlers["camera-file"]({ target: { files: [{}] } });
  for (const error of [false, true]) {
    elements["btn-camera-shoot"].hidden = true;
    sandbox.api = async () => { if (error) throw new Error("offline"); return { found: false }; };
    await gallery();
    assert.equal(elements["btn-camera-shoot"].hidden, false);
    assert.equal(sandbox.camera.busy, false);
  }
  elements["btn-camera-shoot"].hidden = true;
  let finish;
  sandbox.detectBarcode = () => new Promise((resolve) => { finish = resolve; });
  const pending = gallery();
  await new Promise((resolve) => setImmediate(resolve));
  sandbox.stopAutoScan();
  finish("");
  await pending;
  assert.equal(elements["btn-camera-shoot"].hidden, true);
});
