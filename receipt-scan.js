// Find the bright paper band in several rows, then let the user refine it.
function receiptPaperBounds(pixels, width, height) {
  const bands = [];
  for (const fraction of [0.15, 0.25, 0.35, 0.5, 0.65, 0.75, 0.85]) {
    const y = Math.min(height - 1, Math.floor(height * fraction));
    let start = null;
    const runs = [];
    for (let x = 0; x <= width; x++) {
      const offset = (y * width + x) * 4;
      const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
      const paper = x < width && Math.min(r,g,b) > 155 && Math.max(r,g,b) - Math.min(r,g,b) < 55;
      if (paper && start === null) start = x;
      // Bridge small gaps made by receipt text.
      if (start !== null && (!paper || x === width)) {
        const end = x;
        if (end - start > width * 0.08) runs.push([start,end]);
        start = null;
      }
    }
    const central = runs.filter(([left,right]) => left < width * 0.6 && right > width * 0.4)
      .sort((a,b) => (b[1]-b[0]) - (a[1]-a[0]))[0];
    if (central) bands.push(central);
  }
  if (bands.length < 3) return {left:0,right:100,top:0,bottom:100};
  const left = Math.max(0, Math.floor(Math.min(...bands.map(band => band[0])) / width * 100));
  const right = Math.min(100, Math.ceil(Math.max(...bands.map(band => band[1])) / width * 100));
  if (right - left < 15) return {left:0,right:100,top:0,bottom:100};
  return {left,right,top:0,bottom:100};
}

function enhanceReceiptPixels(pixels) {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = Math.round(pixels[i] * 0.299 + pixels[i+1] * 0.587 + pixels[i+2] * 0.114);
    pixels[i] = pixels[i+1] = pixels[i+2] = gray;
    histogram[gray]++;
  }
  const count = pixels.length / 4;
  let low = 0, high = 255, sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += histogram[i];
    if (sum >= count * 0.01) { low = i; break; }
  }
  sum = 0;
  for (let i = 255; i >= 0; i--) {
    sum += histogram[i];
    if (sum >= count * 0.01) { high = i; break; }
  }
  if (high - low < 30) return;
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = Math.max(0, Math.min(255, Math.round((pixels[i] - low) * 255 / (high - low))));
    pixels[i] = pixels[i+1] = pixels[i+2] = gray;
  }
}

function thresholdReceiptPixels(pixels, width, height) {
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += pixels[(y * width + x) * 4];
      integral[(y+1)*stride+x+1] = integral[y*stride+x+1] + row;
    }
  }
  const radius = Math.max(12,Math.round(width / 45));
  for (let y = 0; y < height; y++) {
    const top = Math.max(0,y-radius), bottom = Math.min(height,y+radius+1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0,x-radius), right = Math.min(width,x+radius+1);
      const sum = integral[bottom*stride+right] - integral[top*stride+right] - integral[bottom*stride+left] + integral[top*stride+left];
      const mean = sum / ((right-left)*(bottom-top));
      const offset = (y*width+x)*4;
      const value = pixels[offset] < mean - 9 ? 0 : 255;
      pixels[offset] = pixels[offset+1] = pixels[offset+2] = value;
    }
  }
}
