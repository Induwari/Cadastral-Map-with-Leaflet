# Cadastral Notes Map (Leaflet + Draw) - v2

What you get
- Cadastral overlay (Eastwood.geojson) loaded as a toggleable overlay layer.
- Frontend status indicator:
  - shows cadastral is loading / loaded / hidden
  - includes a Snap to parcel toggle
- Parcel hover highlighting.
- Parcel notes:
  - click a parcel, add a note, save/cancel, undo in toast
  - stored separately in localStorage (key: cadastral_parcel_notes_v1)
- User drawings + notes:
  - draw shapes/markers, click to add notes, undo in toast
  - stored in localStorage (key: leaflet_drawings_with_notes_v1)
- Optional snapping:
  - if Snap to parcel is enabled, new drawings are replaced with the parcel polygon under the drawing's centroid.

Run locally
Because the app uses fetch() to load the GeoJSON, you should run it via a local server.

Option A: VS Code Live Server
1. Open this folder in VS Code
2. Install Live Server
3. Right-click index.html -> Open with Live Server

Option B: Python simple server
In this folder:
python -m http.server 5173

Open:
http://localhost:5173

Replace the overlay
Replace Eastwood.geojson with your own GeoJSON file and keep the same filename,
or update fetch('./Eastwood.geojson') in app.js.
