function screenPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const source = e?.changedTouches?.[0] || e?.touches?.[0] || e;
  if (!source || !rect.width || !rect.height) return null;
  // Map screen coordinates to canvas logical space.
  // rect.width/height = visual dimensions (CSS-scaled with aspect-ratio).
  // canvas.width/height = logical canvas dimensions (1000x650).
  // No devicePixelRatio adjustment needed here because getBoundingClientRect
  // already returns CSS pixel coordinates.
  return {
    x: (source.clientX - rect.left) * (canvas.width / rect.width),
    y: (source.clientY - rect.top) * (canvas.height / rect.height)
  };
}
