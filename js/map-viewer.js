(function () {
  "use strict";

  if (!window.L || !window.proj4) {
    document.getElementById("message").textContent = "Kaartbibliotheken konden niet worden geladen. Controleer de internetverbinding.";
    document.getElementById("message").className = "message error";
    return;
  }

  proj4.defs(
    "EPSG:28992",
    "+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38763888888889 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.2369,50.0087,465.658,-0.406857330322398,0.350732676542563,-1.8703473836068,4.0812 +units=m +no_defs"
  );

  const map = L.map("map").setView([52.67, 4.82], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 21,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  let pipes = [];
  let layers = [];
  let selected = null;
  let projectBounds = null;
  let locationMarker = null;
  let currentProjectName = "";
  let currentFileName = "";
  let ribxXmlDoc = null;
  let manholes = [];
  let ribxDirty = false;
  const statuses = new Map();

  const els = {
    fileInput: document.getElementById("fileInput"),
    searchBox: document.getElementById("searchBox"),
    streetFilter: document.getElementById("streetFilter"),
    typeFilter: document.getElementById("typeFilter"),
    pipeCount: document.getElementById("pipeCount"),
    manholeCount: document.getElementById("manholeCount"),
    totalLength: document.getElementById("totalLength"),
    streetCount: document.getElementById("streetCount"),
    details: document.getElementById("details"),
    streetList: document.getElementById("streetList"),
    fitBtn: document.getElementById("fitBtn"),
    doneBtn: document.getElementById("doneBtn"),
    problemBtn: document.getElementById("problemBtn"),
    clearStatusBtn: document.getElementById("clearStatusBtn"),
    message: document.getElementById("message"),
    saveProgressBtn: document.getElementById("saveProgressBtn"),
    progressInput: document.getElementById("progressInput"),
    clearAllProgressBtn: document.getElementById("clearAllProgressBtn"),
    locateBtn: document.getElementById("locateBtn"),
    shareBtn: document.getElementById("shareBtn"),
    pipeEditHint: document.getElementById("pipeEditHint"),
    pipeInspectionStatus: document.getElementById("pipeInspectionStatus"),
    pipeInspectionReason: document.getElementById("pipeInspectionReason"),
    pipeCleaningStatus: document.getElementById("pipeCleaningStatus"),
    pipeCleaningReason: document.getElementById("pipeCleaningReason"),
    pipeCleaningMethod: document.getElementById("pipeCleaningMethod"),
    pipeCleaningDate: document.getElementById("pipeCleaningDate"),
    pipeNotCleanedReason: document.getElementById("pipeNotCleanedReason"),
    applyPipeRibxBtn: document.getElementById("applyPipeRibxBtn"),
    manholeSelect: document.getElementById("manholeSelect"),
    putInspectionStatus: document.getElementById("putInspectionStatus"),
    putInspectionReason: document.getElementById("putInspectionReason"),
    putCleaningStatus: document.getElementById("putCleaningStatus"),
    putCleaningReason: document.getElementById("putCleaningReason"),
    putNotCleanedReason: document.getElementById("putNotCleanedReason"),
    applyPutRibxBtn: document.getElementById("applyPutRibxBtn"),
    downloadRibxBtn: document.getElementById("downloadRibxBtn"),
  };

  function setMessage(text, type) {
    els.message.textContent = text || "";
    els.message.className = `message ${type || "muted"}`;
  }

  function rdToLatLng(x, y) {
    const nx = Number(String(x).replace(",", "."));
    const ny = Number(String(y).replace(",", "."));
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) return null;
    const out = proj4("EPSG:28992", "WGS84", [nx, ny]);
    return [out[1], out[0]];
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    }[char]));
  }

  function localName(tagName) {
    return String(tagName || "").split(":").pop().toLowerCase();
  }

  function descendantsByLocalName(el, names) {
    const wanted = new Set(names.map((name) => String(name).toLowerCase()));
    return Array.from(el.getElementsByTagName("*")).filter((node) => {
      return wanted.has(localName(node.tagName)) || wanted.has(node.tagName.toLowerCase());
    });
  }

  function textOf(el, names) {
    for (const name of names) {
      const exact = el.getElementsByTagName(name)[0];
      if (exact && exact.textContent.trim()) return exact.textContent.trim();
      const local = descendantsByLocalName(el, [name])[0];
      if (local && local.textContent.trim()) return local.textContent.trim();
    }
    return "";
  }

  function directTextOf(el, names) {
    const wanted = new Set(names.map((name) => String(name).toLowerCase()));
    const child = Array.from(el.children || []).find((node) => wanted.has(localName(node.tagName)));
    return child ? child.textContent.trim() : "";
  }

  function attrOf(el, names) {
    for (const name of names) {
      const value = el.getAttribute(name);
      if (value) return value;
    }
    return "";
  }

  function extractNumbers(text) {
    const matches = String(text || "").match(/[-+]?\d+(?:[\.,]\d+)?/g);
    if (!matches) return [];
    return matches.map((value) => Number(value.replace(",", "."))).filter(Number.isFinite);
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function readSewerTypeValue(el) {
    // Belangrijk:
    // ACJ = soort riool. In het testbestand staat ACJ overal op A, dus die is NIET geschikt
    // om HWA/DWA te onderscheiden.
    // ACK = gebruik riolering. Die gebruiken we eerst voor hemel/vuil/gemengd.
    return (
      textOf(el, ["ACK", "GebruikRiolering", "gebruikRiolering", "Gebruik_riool", "Rioolgebruik", "rioolgebruik"]) ||
      textOf(el, ["SoortStelsel", "soortStelsel", "Stelseltype", "stelseltype", "Riooltype", "TypeRiool"]) ||
      attrOf(el, ["gebruikRiolering", "rioolgebruik", "sewerUse", "sewerType", "type"])
    );
  }

  function classifySewerType(rawValue) {
    const raw = String(rawValue || "").trim();
    const value = normalizeText(raw);

    if (!value) return { key: "onbekend", label: "Onbekend", raw: "" };

    if (/(vuil|dwa|afval|droogweer|foul|waste|sanitary)/.test(value)) {
      return { key: "vuil", label: "Vuilwater", raw };
    }
    if (/(hemel|hwa|rwa|regen|storm|rain|surface)/.test(value)) {
      return { key: "hemel", label: "Hemelwater", raw };
    }
    if (/(gemengd|mixed|combined)/.test(value)) {
      return { key: "gemengd", label: "Gemengd", raw };
    }
    if (/(drain|drainage|infiltratie)/.test(value)) {
      return { key: "drainage", label: "Drainage", raw };
    }

    // Praktische mapping op basis van ACK = Gebruik riolering.
    // Hiermee voorkomen we dat ACJ=A alles rood maakt.
    if (value === "a") return { key: "vuil", label: "Vuilwater", raw };
    if (value === "b") return { key: "hemel", label: "Hemelwater", raw };
    if (value === "c") return { key: "gemengd", label: "Gemengd", raw };
    if (value === "d") return { key: "drainage", label: "Drainage", raw };

    return { key: "onbekend", label: `Onbekend / overig`, raw };
  }

  function sewerTypeOf(el) {
    return classifySewerType(readSewerTypeValue(el));
  }

  function formatLength(value) {
    const num = Number(String(value || "").replace(",", "."));
    if (!Number.isFinite(num)) return value ? String(value) : "?";
    return `${num.toLocaleString("nl-NL", { maximumFractionDigits: 2 })} m`;
  }

  function sewerColor(key) {
    if (key === "vuil") return "#d93025";
    if (key === "hemel") return "#1769aa";
    if (key === "gemengd") return "#7c3aed";
    if (key === "drainage") return "#0c766c";
    return "#6b7280";
  }


  function parseCoordinatesFromText(text) {
    const nums = extractNumbers(text);
    const coords = [];
    for (let index = 0; index + 1 < nums.length; index += 2) {
      const point = rdToLatLng(nums[index], nums[index + 1]);
      if (point) coords.push(point);
    }
    return coords;
  }

  function firstDescendantByLocalName(el, names) {
    return descendantsByLocalName(el, names)[0] || null;
  }

  function getCoords(el) {
    const coordinateTags = ["Coordinates", "coordinates", "Coordinaat", "coordinaat", "LineString", "posList", "Geometry", "geometry"];
    for (const tag of coordinateTags) {
      const node = firstDescendantByLocalName(el, [tag]);
      if (node) {
        const coords = parseCoordinatesFromText(node.textContent);
        if (coords.length >= 2) return coords;
      }
    }

    const x1 = textOf(el, ["X1", "x1", "BeginX", "StartX", "FromX", "X_Begin", "XStart"]);
    const y1 = textOf(el, ["Y1", "y1", "BeginY", "StartY", "FromY", "Y_Begin", "YStart"]);
    const x2 = textOf(el, ["X2", "x2", "EndX", "EindX", "ToX", "X_Eind", "XEnd"]);
    const y2 = textOf(el, ["Y2", "y2", "EndY", "EindY", "ToY", "Y_Eind", "YEnd"]);
    const a = rdToLatLng(x1, y1);
    const b = rdToLatLng(x2, y2);
    if (a && b) return [a, b];
    return [];
  }

  function pipeId(el, index) {
    return (
      attrOf(el, ["id", "ID", "Id", "guid", "GUID"]) ||
      textOf(el, ["Code", "code", "ObjectID", "ObjectId", "InspectionObjectCode", "Strengcode", "strengcode", "AAA"]) ||
      `streng-${index + 1}`
    );
  }

  function candidatePipeElements(xml) {
    const all = Array.from(xml.getElementsByTagName("*"));
    return all.filter((el) => {
      const name = el.tagName.toLowerCase();
      const hasPipeName = /pipe|streng|leiding|riool|inspectionobject/.test(name);
      const coords = getCoords(el);
      return hasPipeName && coords.length >= 2;
    });
  }

  function posIn(el, tag) {
    const container = firstDescendantByLocalName(el, [tag]);
    if (!container) return null;
    const pos = firstDescendantByLocalName(container, ["pos"]);
    const nums = extractNumbers(pos ? pos.textContent : container.textContent);
    if (nums.length < 2) return null;
    return rdToLatLng(nums[0], nums[1]);
  }

  function parseGwswRibx(xml) {
    const elems = Array.from(xml.getElementsByTagName("*")).filter((el) => localName(el.tagName) === "zb_a");
    const parsed = elems.map((el, index) => {
      const a = posIn(el, "AAE");
      const b = posIn(el, "AAG");
      if (!a || !b) return null;
      return {
        id: textOf(el, ["AAA"]) || `streng-${index + 1}`,
        from: textOf(el, ["AAD"]),
        to: textOf(el, ["AAF"]),
        street: textOf(el, ["AAJ"]) || "Onbekende straat",
        length: textOf(el, ["ABQ"]),
        diameter: textOf(el, ["ACB", "ACC"]),
        material: textOf(el, ["ACD", "GCD"]),
        sewerType: sewerTypeOf(el),
        coords: [a, b],
        inspectionNode: el,
      };
    }).filter(Boolean);
    return dedupePipes(parsed);
  }

  function parseManholes(xml, parsedPipes) {
    const byId = new Map();
    parsedPipes.forEach((pipe) => {
      [pipe.from, pipe.to].filter(Boolean).forEach((id) => {
        if (!byId.has(id)) byId.set(id, { id, inspectionNode: null, cleaningNode: null });
      });
    });

    Array.from(xml.getElementsByTagName("*")).forEach((el) => {
      const name = localName(el.tagName);
      if (name === "zb_c") {
        const id = directTextOf(el, ["CAA"]) || textOf(el, ["CAA", "Putnummer", "Put", "Node"]);
        if (id) byId.set(id, { ...(byId.get(id) || { id }), inspectionNode: el });
      }
      if (name === "zb_j") {
        const id = directTextOf(el, ["JAA"]) || textOf(el, ["JAA", "Putnummer", "Put", "Node"]);
        if (id) byId.set(id, { ...(byId.get(id) || { id }), cleaningNode: el });
      }
    });

    return Array.from(byId.values()).sort((a, b) => String(a.id).localeCompare(String(b.id), "nl"));
  }

  function dedupePipes(items) {
    const unique = new Map();
    items.forEach((pipe) => {
      if (!pipe || !pipe.coords || pipe.coords.length < 2) return;
      unique.set(pipe.id + JSON.stringify(pipe.coords), pipe);
    });
    return Array.from(unique.values());
  }

  function parseRibx(xml) {
    const parserError = xml.getElementsByTagName("parsererror")[0];
    if (parserError) throw new Error("Het bestand kon niet als XML/RIBX gelezen worden.");

    const gwswRibx = parseGwswRibx(xml);
    if (gwswRibx.length) return gwswRibx;

    const elems = candidatePipeElements(xml);
    const parsed = elems.map((el, index) => ({
      id: pipeId(el, index),
      street: textOf(el, ["Street", "street", "Straat", "straat", "StreetName", "Straatnaam", "straatnaam"]) || "Onbekende straat",
      from: textOf(el, ["FromNode", "fromNode", "BeginPut", "VanPut", "PutBegin", "startNode", "StartNode"]) || "",
      to: textOf(el, ["ToNode", "toNode", "EindPut", "NaarPut", "PutEind", "endNode", "EndNode"]) || "",
      length: textOf(el, ["Length", "length", "Lengte", "lengte"]) || "",
      diameter: textOf(el, ["Diameter", "diameter", "NominalDiameter", "Buisdiameter"]) || "",
      material: textOf(el, ["Material", "Materiaal", "materiaal"]) || "",
      sewerType: sewerTypeOf(el),
      coords: getCoords(el),
      inspectionNode: el,
    }));
    return dedupePipes(parsed);
  }

  function progressStorageKey() {
    return currentProjectName ? `ribx-progress-${currentProjectName}` : "";
  }

  function buildProgressPayload() {
    return {
      app: "RIBX Kaartviewer",
      version: 1,
      savedAt: new Date().toISOString(),
      projectName: currentProjectName,
      sourceFile: currentFileName,
      statuses: Array.from(statuses.entries()).map(([id, status]) => ({ id, status })),
    };
  }

  function autoSaveProgress() {
    const key = progressStorageKey();
    if (key) localStorage.setItem(key, JSON.stringify(buildProgressPayload()));
  }

  function applyProgressPayload(payload) {
    if (!payload || !Array.isArray(payload.statuses)) throw new Error("Ongeldig voortgangsbestand.");
    statuses.clear();
    const pipeIds = new Set(pipes.map((pipe) => pipe.id));
    let applied = 0;
    payload.statuses.forEach((item) => {
      if (!item || !item.id || !item.status) return;
      if (!pipeIds.has(item.id)) return;
      if (!["done", "problem"].includes(item.status)) return;
      statuses.set(item.id, item.status);
      applied += 1;
    });
    if (selected) selectPipe(selected);
    else draw(false);
    updateProgressStats();
    return applied;
  }

  function autoLoadProgress() {
    const key = progressStorageKey();
    if (!key) return false;
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    try {
      applyProgressPayload(JSON.parse(raw));
      return true;
    } catch (error) {
      console.warn("Automatisch laden van voortgang is mislukt:", error);
      return false;
    }
  }

  function downloadText(filename, text, mimeType) {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function findDirectChild(el, tagName) {
    return Array.from(el.children || []).find((child) => localName(child.tagName) === tagName.toLowerCase()) || null;
  }

  function setDirectChildText(el, tagName, value) {
    if (!el || value === "") return;
    let child = findDirectChild(el, tagName);
    if (!child) {
      child = ribxXmlDoc.createElement(tagName);
      insertChildAlphabetically(el, child);
    }
    child.textContent = value;
  }

  function removeDirectChild(el, tagName) {
    const child = findDirectChild(el, tagName);
    if (child) child.remove();
  }

  function insertChildAlphabetically(parent, child) {
    const childName = localName(child.tagName);
    const before = Array.from(parent.children || []).find((node) => localName(node.tagName) > childName);
    parent.insertBefore(child, before || null);
  }

  function firstElementByLocalName(doc, tagName) {
    return Array.from(doc.getElementsByTagName("*")).find((el) => localName(el.tagName) === tagName.toLowerCase()) || null;
  }

  function findHeaderById(tagName, idTags, id) {
    if (!ribxXmlDoc || !id) return null;
    return Array.from(ribxXmlDoc.getElementsByTagName("*")).find((el) => {
      if (localName(el.tagName) !== tagName.toLowerCase()) return false;
      return idTags.some((idTag) => directTextOf(el, [idTag]) === id);
    }) || null;
  }

  function createHeader(tagName, idTag, id) {
    const root = ribxXmlDoc.documentElement;
    const node = ribxXmlDoc.createElement(tagName);
    setDirectChildText(node, idTag, id);
    root.appendChild(node);
    return node;
  }

  function ensurePipeCleaningHeader(pipe) {
    return findHeaderById("zb_g", ["GAA"], pipe.id) || createHeader("ZB_G", "GAA", pipe.id);
  }

  function ensurePutInspectionHeader(putId) {
    const existing = findHeaderById("zb_c", ["CAA"], putId);
    if (existing) return existing;
    const node = createHeader("ZB_C", "CAA", putId);
    const put = manholes.find((item) => item.id === putId);
    if (put) put.inspectionNode = node;
    return node;
  }

  function ensurePutCleaningHeader(putId) {
    const existing = findHeaderById("zb_j", ["JAA"], putId);
    if (existing) return existing;
    const node = createHeader("ZB_J", "JAA", putId);
    const put = manholes.find((item) => item.id === putId);
    if (put) put.cleaningNode = node;
    return node;
  }

  function applyPipeRibxFields() {
    if (!ribxXmlDoc || !selected) {
      setMessage("Open een RIBX-bestand en kies eerst een leiding.", "error");
      return;
    }

    const inspectionNode = selected.inspectionNode || findHeaderById("zb_a", ["AAA"], selected.id);
    const cleaningNode = ensurePipeCleaningHeader(selected);
    let changed = 0;

    if (els.pipeInspectionStatus.value && inspectionNode) {
      if (els.pipeInspectionStatus.value === "not-inspected") {
        setDirectChildText(inspectionNode, "AXD", els.pipeInspectionReason.value || "Z");
      } else {
        removeDirectChild(inspectionNode, "AXD");
      }
      changed += 1;
    }

    if (els.pipeCleaningStatus.value) {
      if (els.pipeCleaningStatus.value === "not-cleaned") {
        setDirectChildText(cleaningNode, "GXD", els.pipeNotCleanedReason.value || "Z");
      } else {
        removeDirectChild(cleaningNode, "GXD");
        if (els.pipeCleaningReason.value) setDirectChildText(cleaningNode, "GBP", els.pipeCleaningReason.value);
        if (els.pipeCleaningMethod.value) setDirectChildText(cleaningNode, "GBE", els.pipeCleaningMethod.value);
        if (els.pipeCleaningDate.value) setDirectChildText(cleaningNode, "GBF", els.pipeCleaningDate.value);
      }
      changed += 1;
    }

    if (changed === 0) {
      setMessage("Kies eerst welke leidingvelden je wilt wijzigen.", "error");
      return;
    }

    ribxDirty = true;
    statuses.set(selected.id, els.pipeCleaningStatus.value === "not-cleaned" ? "problem" : "done");
    autoSaveProgress();
    selectPipe(selected);
    updateProgressStats();
    setMessage(`RIBX-velden bijgewerkt voor leiding ${selected.id}. Download daarna het bijgewerkte RIBX-bestand.`, "ok");
  }

  function applyPutRibxFields() {
    const putId = els.manholeSelect.value;
    if (!ribxXmlDoc || !putId) {
      setMessage("Open een RIBX-bestand en kies eerst een put.", "error");
      return;
    }

    let changed = 0;
    if (els.putInspectionStatus.value) {
      const inspectionNode = ensurePutInspectionHeader(putId);
      if (els.putInspectionStatus.value === "not-inspected") {
        setDirectChildText(inspectionNode, "CXD", els.putInspectionReason.value || "Z");
      } else {
        removeDirectChild(inspectionNode, "CXD");
      }
      changed += 1;
    }

    if (els.putCleaningStatus.value) {
      const cleaningNode = ensurePutCleaningHeader(putId);
      if (els.putCleaningStatus.value === "not-cleaned") {
        setDirectChildText(cleaningNode, "JXD", els.putNotCleanedReason.value || "Z");
      } else {
        removeDirectChild(cleaningNode, "JXD");
        if (els.putCleaningReason.value) setDirectChildText(cleaningNode, "JBP", els.putCleaningReason.value);
      }
      changed += 1;
    }

    if (changed === 0) {
      setMessage("Kies eerst welke putvelden je wilt wijzigen.", "error");
      return;
    }

    ribxDirty = true;
    setMessage(`RIBX-velden bijgewerkt voor put ${putId}. Download daarna het bijgewerkte RIBX-bestand.`, "ok");
  }

  function downloadUpdatedRibx() {
    if (!ribxXmlDoc) {
      setMessage("Open eerst een RIBX/RIPX bestand.", "error");
      return;
    }

    const xml = new XMLSerializer().serializeToString(ribxXmlDoc);
    const prefix = xml.startsWith("<?xml") ? "" : '<?xml version="1.0" encoding="UTF-8"?>\n';
    const base = (currentFileName || "bijgewerkt.ribx").replace(/\.[^.]+$/, "");
    downloadText(`${base}_bijgewerkt.ribx`, prefix + xml, "application/xml;charset=utf-8");
    ribxDirty = false;
    setMessage(`Bijgewerkt RIBX-bestand gedownload als ${base}_bijgewerkt.ribx.`, "ok");
  }

  function downloadProgress() {
    if (!pipes.length) {
      setMessage("Open eerst een RIBX/RIPX bestand voordat je voortgang opslaat.", "error");
      return;
    }
    const safeName = (currentProjectName || "ribx-project").replace(/[^a-z0-9_-]+/gi, "_");
    downloadText(`${safeName}_json_backup.json`, JSON.stringify(buildProgressPayload(), null, 2), "application/json");
    setMessage("JSON-backup gedownload. Gebruik 'Download bijgewerkt .ribx bestand' voor de RIBX-export.", "ok");
  }

  function copyShareLink() {
    const url = window.location.href.split("#")[0];
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => setMessage("Link gekopieerd. Deze kun je per e-mail of WhatsApp versturen.", "ok"));
    } else {
      window.prompt("Kopieer deze link:", url);
    }
  }

  function showMyLocation() {
    if (!navigator.geolocation) {
      setMessage("Locatiebepaling wordt niet ondersteund door deze browser.", "error");
      return;
    }
    setMessage("Locatie wordt bepaald...", "muted");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latlng = [position.coords.latitude, position.coords.longitude];
        if (locationMarker) map.removeLayer(locationMarker);
        locationMarker = L.circleMarker(latlng, {
          radius: 8,
          weight: 3,
          color: "#111827",
          fillColor: "#2563eb",
          fillOpacity: 0.8,
        }).addTo(map);
        locationMarker.bindTooltip("Mijn locatie", { permanent: false });
        map.setView(latlng, 18);
        setMessage("Locatie getoond op de kaart.", "ok");
      },
      () => setMessage("Locatie kon niet worden bepaald. Geef de browser toestemming voor locatiegebruik.", "error"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );
  }

  function updateProgressStats() {
    const done = Array.from(statuses.values()).filter((value) => value === "done").length;
    const problem = Array.from(statuses.values()).filter((value) => value === "problem").length;
    if (pipes.length) setMessage(`${pipes.length} strengen geladen. Gereinigd: ${done}. Aandachtspunt: ${problem}.`, "ok");
  }

  function lineColor(pipe) {
    if (selected && selected.id === pipe.id) return "#f59e0b";
    return sewerColor(pipe.sewerType && pipe.sewerType.key);
  }

  function lineDashArray(pipe) {
    return statuses.get(pipe.id) === "problem" ? "8 7" : null;
  }

  function lineWeight(pipe) {
    if (selected && selected.id === pipe.id) return 8;
    return statuses.get(pipe.id) === "done" ? 6 : 4;
  }

  function draw(shouldFit) {
    layers.forEach((layer) => map.removeLayer(layer));
    layers = [];
    const query = els.searchBox.value.toLowerCase().trim();
    const streetFilter = els.streetFilter.value;
    const typeFilter = els.typeFilter ? els.typeFilter.value : "";
    const shown = pipes.filter((pipe) => {
      const haystack = `${pipe.id} ${pipe.street} ${pipe.from} ${pipe.to} ${pipe.length} ${pipe.sewerType?.label || ""}`.toLowerCase();
      const pipeType = pipe.sewerType && pipe.sewerType.key ? pipe.sewerType.key : "onbekend";
      return (!query || haystack.includes(query)) && (!streetFilter || pipe.street === streetFilter) && (!typeFilter || pipeType === typeFilter);
    });

    projectBounds = L.latLngBounds([]);
    shown.forEach((pipe) => {
      const isSelected = selected && selected.id === pipe.id;
      const layer = L.polyline(pipe.coords, {
        color: lineColor(pipe),
        weight: lineWeight(pipe),
        opacity: 0.95,
        dashArray: lineDashArray(pipe),
      }).addTo(map);
      layer.on("click", () => selectPipe(pipe));
      layer.bindTooltip(
        `<b>${escapeHtml(pipe.id)}</b><br>${escapeHtml(pipe.sewerType?.label || "Onbekend")} · ${escapeHtml(formatLength(pipe.length))}<br>${escapeHtml(pipe.street)}<br>${escapeHtml(pipe.from || "?")} → ${escapeHtml(pipe.to || "?")}`,
        { sticky: true }
      );
      layers.push(layer);
      pipe.coords.forEach((coord) => projectBounds.extend(coord));
    });
    if (shouldFit && projectBounds.isValid()) map.fitBounds(projectBounds.pad(0.15));
  }

  function selectPipe(pipe) {
    selected = pipe;
    els.pipeEditHint.textContent = `Geselecteerd: ${pipe.id}`;
    els.details.className = "details";
    const typeKey = pipe.sewerType?.key || "onbekend";
    const typeLabel = pipe.sewerType?.label || "Onbekend";
    const rawType = pipe.sewerType?.raw ? ` (${pipe.sewerType.raw})` : "";
    els.details.innerHTML = `
      <b>Streng:</b> ${escapeHtml(pipe.id)}<br>
      <b>Type:</b> <span class="type-badge type-${escapeHtml(typeKey)}">${escapeHtml(typeLabel)}</span>${escapeHtml(rawType)}<br>
      <b>Straat:</b> ${escapeHtml(pipe.street)}<br>
      <b>Van / naar:</b> ${escapeHtml(pipe.from || "?")} / ${escapeHtml(pipe.to || "?")}<br>
      <b>Lengte:</b> <span class="length-highlight">${escapeHtml(formatLength(pipe.length))}</span><br>
      <b>Diameter:</b> ${escapeHtml(pipe.diameter || "?")} mm<br>
      <b>Materiaal:</b> ${escapeHtml(pipe.material || "?")}<br>
      <b>Status:</b> ${escapeHtml(statuses.get(pipe.id) || "nog te reinigen")}
    `;
    draw(false);
  }

  function updateStats() {
    const manholeIds = new Set();
    let total = 0;
    const streetCounts = new Map();
    const typeCounts = new Map();
    pipes.forEach((pipe) => {
      if (pipe.from) manholeIds.add(pipe.from);
      if (pipe.to) manholeIds.add(pipe.to);
      const length = Number(String(pipe.length).replace(",", "."));
      if (Number.isFinite(length)) total += length;
      streetCounts.set(pipe.street, (streetCounts.get(pipe.street) || 0) + 1);

      const typeKey = pipe.sewerType?.key || "onbekend";
      const typeLabel = pipe.sewerType?.label || "Onbekend";
      const entry = typeCounts.get(typeKey) || { label: typeLabel, count: 0, length: 0 };
      entry.count += 1;
      if (Number.isFinite(length)) entry.length += length;
      typeCounts.set(typeKey, entry);
    });

    els.pipeCount.textContent = pipes.length;
    els.manholeCount.textContent = manholes.length || manholeIds.size;
    els.totalLength.textContent = `${Math.round(total).toLocaleString("nl-NL")} m`;
    els.streetCount.textContent = streetCounts.size;
    els.streetFilter.innerHTML =
      '<option value="">Alle straten</option>' +
      Array.from(streetCounts.keys()).sort().map((street) => `<option>${escapeHtml(street)}</option>`).join("");
    const typeSummary = Array.from(typeCounts.entries()).map(([key, entry]) => {
      return `<div class="street-item"><span><span class="type-badge type-${escapeHtml(key)}">${escapeHtml(entry.label)}</span></span><b>${entry.count} · ${Math.round(entry.length).toLocaleString("nl-NL")} m</b></div>`;
    }).join("");

    els.streetList.innerHTML =
      (typeSummary ? `<div class="small-text"><b>Riooltypes</b></div>${typeSummary}<div class="small-text"><b>Straten</b></div>` : "") +
      (Array.from(streetCounts.entries()).sort((a, b) => b[1] - a[1]).map(([street, count]) => {
        return `<div class="street-item"><span>${escapeHtml(street)}</span><b>${count}</b></div>`;
      }).join("") || "Geen straten gevonden.");
    updateManholeSelect();
  }

  function updateManholeSelect() {
    if (!manholes.length) {
      els.manholeSelect.innerHTML = '<option value="">Nog geen putten geladen</option>';
      return;
    }

    els.manholeSelect.innerHTML =
      '<option value="">Kies een put</option>' +
      manholes.map((put) => `<option value="${escapeHtml(put.id)}">${escapeHtml(put.id)}</option>`).join("");
  }

  function resetViewer() {
    pipes = [];
    selected = null;
    statuses.clear();
    ribxXmlDoc = null;
    manholes = [];
    ribxDirty = false;
    currentProjectName = "";
    currentFileName = "";
    updateStats();
    draw(false);
    els.details.className = "details muted";
    els.details.textContent = "Klik op een streng op de kaart.";
    els.pipeEditHint.textContent = "Klik eerst op een leiding op de kaart.";
    updateManholeSelect();
  }

  function readFileAsText(file) {
    if (file && typeof file.text === "function") return file.text();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Bestand kon niet worden gelezen."));
      reader.readAsText(file, "UTF-8");
    });
  }

  async function loadFile(file) {
    setMessage("Bestand wordt gelezen...", "muted");
    const text = await readFileAsText(file);
    const xml = new DOMParser().parseFromString(text, "text/xml");
    ribxXmlDoc = xml;
    pipes = parseRibx(xml);
    manholes = parseManholes(xml, pipes);
    ribxDirty = false;
    currentFileName = file.name;
    currentProjectName = file.name.replace(/\.[^.]+$/, "");
    selected = null;
    statuses.clear();
    const restored = autoLoadProgress();
    updateStats();
    draw(true);
    if (pipes.length) {
      const done = Array.from(statuses.values()).filter((value) => value === "done").length;
      const problem = Array.from(statuses.values()).filter((value) => value === "problem").length;
      setMessage(
        `${pipes.length} strengen geladen uit ${file.name}.${restored ? " Opgeslagen voortgang automatisch hersteld." : ""} Gereinigd: ${done}. Aandachtspunt: ${problem}.`,
        "ok"
      );
    } else {
      setMessage("Geen strengen met coordinaten gevonden. Mogelijk gebruikt dit RIBX-bestand andere veldnamen.", "error");
    }
  }

  function runTests() {
    console.assert(extractNumbers("123 456.7 -8,9").length === 3, "extractNumbers leest spaties, punten, komma en mintekens");
    console.assert(parseCoordinatesFromText("115000 515000 115010 515010").length === 2, "parseCoordinatesFromText leest twee RD-punten");

    const testXmlText = '<root xmlns:gml="http://www.opengis.net/gml"><ZB_A><AAA>S1</AAA><AAD>P1</AAD><AAF>P2</AAF><AAJ>Teststraat</AAJ><AAE><gml:Point><gml:pos>115000 515000</gml:pos></gml:Point></AAE><AAG><gml:Point><gml:pos>115010 515010</gml:pos></gml:Point></AAG><ABQ>10</ABQ><ACB>300</ACB><ACK>B</ACK></ZB_A></root>';
    const testXml = new DOMParser().parseFromString(testXmlText, "text/xml");
    const parsed = parseRibx(testXml);
    console.assert(parsed.length === 1, "parseRibx leest ZB_A strengen");
    console.assert(parsed[0].street === "Teststraat", "parseRibx leest straatnaam");
  }

  els.fileInput.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const allowed = [".ribx", ".ripx", ".xml"];
      if (!allowed.some((ext) => file.name.toLowerCase().endsWith(ext))) {
        throw new Error("Kies een .ribx, .ripx of .xml bestand.");
      }
      await loadFile(file);
    } catch (error) {
      resetViewer();
      setMessage(error.message || String(error), "error");
      console.error(error);
    } finally {
      event.target.value = "";
    }
  });

  els.progressInput.addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (!pipes.length) throw new Error("Open eerst het bijbehorende RIBX/RIPX bestand.");
      const payload = JSON.parse(await readFileAsText(file));
      const applied = applyProgressPayload(payload);
      autoSaveProgress();
      setMessage(`${applied} statussen geladen uit ${file.name}.`, "ok");
    } catch (error) {
      setMessage(error.message || String(error), "error");
      console.error(error);
    } finally {
      event.target.value = "";
    }
  });

  els.searchBox.addEventListener("input", () => draw(true));
  els.streetFilter.addEventListener("change", () => draw(true));
  if (els.typeFilter) els.typeFilter.addEventListener("change", () => draw(true));
  els.fitBtn.addEventListener("click", () => {
    if (projectBounds && projectBounds.isValid()) map.fitBounds(projectBounds.pad(0.15));
  });
  els.saveProgressBtn.addEventListener("click", downloadProgress);
  els.applyPipeRibxBtn.addEventListener("click", applyPipeRibxFields);
  els.applyPutRibxBtn.addEventListener("click", applyPutRibxFields);
  els.downloadRibxBtn.addEventListener("click", downloadUpdatedRibx);
  els.locateBtn.addEventListener("click", showMyLocation);
  els.shareBtn.addEventListener("click", copyShareLink);
  els.doneBtn.addEventListener("click", () => {
    if (selected) {
      statuses.set(selected.id, "done");
      autoSaveProgress();
      selectPipe(selected);
      updateProgressStats();
    }
  });
  els.problemBtn.addEventListener("click", () => {
    if (selected) {
      statuses.set(selected.id, "problem");
      autoSaveProgress();
      selectPipe(selected);
      updateProgressStats();
    }
  });
  els.clearStatusBtn.addEventListener("click", () => {
    if (selected) {
      statuses.delete(selected.id);
      autoSaveProgress();
      selectPipe(selected);
      updateProgressStats();
    }
  });
  els.clearAllProgressBtn.addEventListener("click", () => {
    statuses.clear();
    autoSaveProgress();
    selected = null;
    els.details.className = "details muted";
    els.details.textContent = "Klik op een streng op de kaart.";
    draw(false);
    updateProgressStats();
  });

  window.addEventListener("beforeunload", (event) => {
    if (!ribxDirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  runTests();
})();
