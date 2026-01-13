(() => {
  // ---- Storage keys ----
  const DRAWINGS_KEY = 'leaflet_drawings_with_notes_v1'
  const CAD_NOTES_KEY = 'cadastral_parcel_notes_v1'

  const toastRoot = document.getElementById('toastRoot')

  // ---- Map ----
  const map = L.map('map', {
    center: [-34.9285, 138.6007], // Adelaide
    zoom: 13,
    minZoom: 10,
    maxZoom: 18
  })

  const baseOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map)

  // ---- Drawn items (persisted) ----
  const drawnItems = new L.FeatureGroup()
  map.addLayer(drawnItems)

  // ---- Toast ----
  function showToast({ title, message, onUndo }) {
    const el = document.createElement('div')
    el.className = 'toast'
    el.innerHTML = `
      <div class="icon">✅</div>
      <div class="content">
        <div class="title">${title}</div>
        <div>${message}</div>
        ${onUndo ? `<div class="actions"><button class="btn-undo">Undo</button></div>` : ``}
      </div>
      <button class="btn-close" aria-label="Close">×</button>
    `
    toastRoot.appendChild(el)

    requestAnimationFrame(() => el.classList.add('show'))

    const close = () => {
      el.classList.remove('show')
      setTimeout(() => el.remove(), 160)
    }

    el.querySelector('.btn-close').onclick = close

    if (onUndo) {
      el.querySelector('.btn-undo').onclick = () => {
        onUndo()
        close()
      }
    }

    setTimeout(close, 2500)
  }

  // ---- Note Popup (shared template) ----
  function notePopupHtml(placeholder = 'Add a note...') {
    return `
      <div class="note-popup">
        <textarea placeholder="${placeholder}"></textarea>
        <div class="note-actions">
          <button class="btn-cancel" type="button">Cancel</button>
          <button class="btn-save primary" type="button">Save Note</button>
        </div>
      </div>
    `
  }

  // ---- Drawings persistence ----
  function saveAllDrawings() {
    localStorage.setItem(DRAWINGS_KEY, JSON.stringify(drawnItems.toGeoJSON()))
  }

  function loadAllDrawings() {
    const saved = localStorage.getItem(DRAWINGS_KEY)
    if (!saved) return

    const geojson = JSON.parse(saved)

    L.geoJSON(geojson, {
      onEachFeature: (feature, layer) => {
        layer.feature = layer.feature || feature || { type: 'Feature', properties: {} }
        attachDrawingNoteUI(layer)

        // optional: show icon if note exists
        if (feature.properties?.note) layer.bindTooltip('📝', { permanent: false })

        drawnItems.addLayer(layer)
      }
    })
  }

  // ---- Drawing note UI ----
  function attachDrawingNoteUI(layer) {
    layer.bindPopup(notePopupHtml('Add a note (Sale value $, comment)...'), {
      maxWidth: 560,
      minWidth: 520,
      autoPan: true
    })

    layer.on('popupopen', e => {
      const popupEl = e.popup.getElement()
      const textarea = popupEl.querySelector('textarea')
      const btnSave = popupEl.querySelector('.btn-save')
      const btnCancel = popupEl.querySelector('.btn-cancel')

      layer.feature = layer.feature || { type: 'Feature', properties: {} }
      layer.feature.properties = layer.feature.properties || {}

      const previousNote = layer.feature.properties.note || ''
      textarea.value = previousNote
      textarea.focus()

      btnCancel.onclick = () => layer.closePopup()

      btnSave.onclick = () => {
        const newNote = textarea.value.trim()
        layer.feature.properties.note = newNote
        saveAllDrawings()
        layer.closePopup()

        showToast({
          title: 'Note saved',
          message: newNote ? 'Your note was saved successfully.' : 'Saved (empty note).',
          onUndo: () => {
            layer.feature.properties.note = previousNote
            saveAllDrawings()
            showToast({ title: 'Undone', message: 'Restored the previous note.' })
          }
        })
      }
    })
  }

  // ---- Cadastral overlay (toggleable, separate from drawnItems) ----
  map.createPane('cadastralPane')
  map.getPane('cadastralPane').style.zIndex = 350

  let cadastralLayer = null
  let cadastralLoaded = false
  let cadastralFeatures = [] // raw GeoJSON features with a stable id
  let parcelNotes = loadParcelNotes()
  let snapEnabled = false

  function loadParcelNotes() {
    try {
      return JSON.parse(localStorage.getItem(CAD_NOTES_KEY) || '{}') || {}
    } catch {
      return {}
    }
  }
  function saveParcelNotes() {
    localStorage.setItem(CAD_NOTES_KEY, JSON.stringify(parcelNotes))
  }

  function getParcelId(feature, index) {
    const props = feature.properties || {}
    // pick the most stable identifier available
    const candidates = [
      feature.id,
      props.PARCEL_ID,
      props.PARCELID,
      props.PARCEL,
      props.LOTPLAN,
      props.LOT_PLAN,
      props.LOT,
      props.PLAN,
      props.OBJECTID,
      props.ObjectID,
      props.ID,
      props.Id
    ].filter(v => v !== undefined && v !== null && String(v).trim() !== '')
    if (candidates.length) return String(candidates[0])
    // fallback (stable for the same file order)
    return `parcel_${index}`
  }

  function getParcelLabel(feature, pid) {
    const props = feature.properties || {}
    const lot = props.LOT
    const plan = props.PLAN
    if (lot && plan) return `${lot}/${plan}`
    return pid
  }

  async function loadCadastralOverlay() {
    const res = await fetch('./Eastwood.geojson')
    if (!res.ok) throw new Error('Failed to load Eastwood.geojson')
    const geojson = await res.json()

    // keep a copy for snapping/searching
    cadastralFeatures = (geojson.features || []).map((f, i) => {
      const pid = getParcelId(f, i)
      const copy = { ...f, properties: { ...(f.properties || {}), __pid: pid } }
      return copy
    })

    cadastralLayer = L.geoJSON(geojson, {
      pane: 'cadastralPane',
      style: () => ({
        weight: 1,
        opacity: 0.9,
        fillOpacity: 0.05
      }),
      onEachFeature: (feature, layer) => {
        const pid = getParcelId(feature, 0)
        const label = getParcelLabel(feature, pid)

        // hover highlight
        if (layer.setStyle) {
          layer.on('mouseover', () => layer.setStyle({ weight: 2, fillOpacity: 0.12 }))
          layer.on('mouseout', () => cadastralLayer && cadastralLayer.resetStyle(layer))
        }

        // show note icon if exists
        if (parcelNotes[pid]) {
          layer.bindTooltip('📝', { permanent: false })
        }
      }
    })

    cadastralLayer.addTo(map)
    cadastralLoaded = true
    updateStatusControl()
  }

  // ---- Layer control + status indicator ----
  const overlays = {}
  const layerControl = L.control.layers(
    { OpenStreetMap: baseOSM },
    overlays,
    { collapsed: false }
  ).addTo(map)

  // simple status control (top-left)
  const StatusControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function () {
      const div = L.DomUtil.create('div', 'leaflet-bar')
      div.style.background = '#fff'
      div.style.padding = '8px 10px'
      div.style.borderRadius = '10px'
      div.style.boxShadow = '0 10px 30px rgba(0,0,0,0.12)'
      div.style.fontSize = '13px'
      div.style.lineHeight = '1.2'
      div.style.cursor = 'default'
      div.innerHTML = `
        <div id="cadStatusLine">Cadastral: loading...</div>
        <label style="display:flex;gap:8px;align-items:center;margin-top:8px;">
          <input id="snapToggle" type="checkbox" />
          <span>Snap to parcel</span>
        </label>
      `
      // prevent map drag when interacting
      L.DomEvent.disableClickPropagation(div)
      return div
    }
  })
  const statusControl = new StatusControl()
  map.addControl(statusControl)

  function updateStatusControl() {
    const el = document.getElementById('cadStatusLine')
    if (!el) return
    const has = cadastralLoaded && cadastralLayer && map.hasLayer(cadastralLayer)
    if (!cadastralLoaded) el.textContent = 'Cadastral: not loaded'
    else if (has) el.textContent = 'Cadastral: loaded'
    else el.textContent = 'Cadastral: hidden'
  }

  // snap toggle wiring
  map.whenReady(() => {
    const snapEl = document.getElementById('snapToggle')
    if (snapEl) {
      snapEl.checked = snapEnabled
      snapEl.onchange = () => {
        snapEnabled = !!snapEl.checked
        showToast({
          title: 'Snap setting',
          message: snapEnabled ? 'Snap to parcel enabled.' : 'Snap to parcel disabled.'
        })
      }
    }
  })

  // ---- Load cadastral and register overlay toggle ----
  loadCadastralOverlay()
    .then(() => {
      overlays['Cadastral (Eastwood)'] = cadastralLayer
      layerControl.addOverlay(cadastralLayer, 'Cadastral (Eastwood)')
      updateStatusControl()
      map.on('overlayadd', updateStatusControl)
      map.on('overlayremove', updateStatusControl)
    })
    .catch(err => {
      console.error(err)
      cadastralLoaded = false
      updateStatusControl()
      showToast({ title: 'Cadastral not loaded', message: 'Could not load Eastwood.geojson.' })
    })

  // ---- Draw controls ----
  const drawControl = new L.Control.Draw({
    edit: { featureGroup: drawnItems },
    draw: { polygon: true, polyline: true, rectangle: true, circle: true, marker: true }
  })
  map.addControl(drawControl)

  // Created
  map.on(L.Draw.Event.CREATED, e => {
    let layer = e.layer

    // optional snap-to-parcel
    if (snapEnabled) {
      const centroid = layerCentroidLatLng(layer)
      if (centroid) {
        const parcelFeature = findParcelFeatureAtLatLng(centroid)
        if (parcelFeature && (parcelFeature.geometry?.type === 'Polygon' || parcelFeature.geometry?.type === 'MultiPolygon')) {
          const snapped = featureToEditableLeafletLayer(parcelFeature)
          if (snapped) {
            layer = snapped
            showToast({
              title: 'Snapped to parcel',
              message: 'Your new drawing was replaced with the parcel boundary under it.'
            })
          }
        }
      }
    }

    layer.feature = layer.feature || { type: 'Feature', properties: {} }
    attachDrawingNoteUI(layer)
    drawnItems.addLayer(layer)
    saveAllDrawings()
    layer.openPopup()
  })

  // Edited / Deleted
  map.on(L.Draw.Event.EDITED, saveAllDrawings)
  map.on(L.Draw.Event.DELETED, saveAllDrawings)

  // Load persisted data
  loadAllDrawings()
})()
