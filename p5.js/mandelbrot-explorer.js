// Mandelbrot Explorer - zoomable mandelbrot set

let minVal = -2.5;
let maxVal = 2.5;
let maxIter = 100;

function setup() {
  createCanvas(600, 400);
  colorMode(HSB);
  pixelDensity(1);
}

function draw() {
  loadPixels();
  
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let a = map(x, 0, width, minVal, maxVal);
      let b = map(y, 0, height, minVal, maxVal);
      
      let ca = a;
      let cb = b;
      
      let n = 0;
      while (n < maxIter) {
        let aa = a * a - b * b;
        let bb = 2 * a * b;
        a = aa + ca;
        b = bb + cb;
        if (a * a + b * b > 16) break;
        n++;
      }
      
      let pix = (x + y * width) * 4;
      if (n === maxIter) {
        pixels[pix] = 0;
        pixels[pix + 1] = 0;
        pixels[pix + 2] = 0;
        pixels[pix + 3] = 255;
      } else {
        let hue = map(n, 0, maxIter, 0, 360);
        let c = color(hue, 80, 100);
        pixels[pix] = red(c);
        pixels[pix + 1] = green(c);
        pixels[pix + 2] = blue(c);
        pixels[pix + 3] = 255;
      }
    }
  }
  
  updatePixels();
  
  colorMode(RGB);
  fill(200);
  noStroke();
  textSize(12);
  text('Mandelbrot set', 10, 20);
  text('Click to zoom in', 10, 35);
  text('Press SPACE to reset', 10, 50);
  text(`Range: ${nf(abs(maxVal - minVal), 1, 4)}`, 10, 65);
  colorMode(HSB);
}

function mousePressed() {
  let range = maxVal - minVal;
  let mouseA = map(mouseX, 0, width, minVal, maxVal);
  let mouseB = map(mouseY, 0, height, minVal, maxVal);
  minVal = mouseA - range / 4;
  maxVal = mouseA + range / 4;
  maxIter += 50;
}

function keyPressed() {
  if (key === ' ') {
    minVal = -2.5;
    maxVal = 2.5;
    maxIter = 100;
  }
}
