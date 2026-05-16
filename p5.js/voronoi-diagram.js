// Voronoi Diagram - interactive voronoi cell visualization

let points = [];
let numPoints = 8;

function setup() {
  createCanvas(600, 400);
  colorMode(HSB);
  
  // Initialize random points
  for (let i = 0; i < numPoints; i++) {
    points.push({
      x: random(width),
      y: random(height),
      hue: random(360)
    });
  }
}

function draw() {
  background(220, 80, 10);
  
  // Draw voronoi diagram
  loadPixels();
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let closestDist = Infinity;
      let closestPoint = null;
      
      // Find closest point
      for (let point of points) {
        let d = dist(x, y, point.x, point.y);
        if (d < closestDist) {
          closestDist = d;
          closestPoint = point;
        }
      }
      
      // Set pixel color based on closest point
      let index = (x + y * width) * 4;
      let c = color(closestPoint.hue, 80, 100);
      pixels[index] = red(c);
      pixels[index + 1] = green(c);
      pixels[index + 2] = blue(c);
      pixels[index + 3] = 255;
    }
  }
  updatePixels();
  
  // Draw points
  for (let point of points) {
    fill(0);
    noStroke();
    ellipse(point.x, point.y, 10);
  }
  
  // Instructions
  colorMode(RGB);
  fill(200);
  noStroke();
  textSize(12);
  text('Voronoi diagram: click to add point', 10, 20);
  text(`Points: ${points.length}`, 10, 35);
  text('Press SPACE to reset', 10, 50);
  colorMode(HSB);
}

function mousePressed() {
  points.push({
    x: mouseX,
    y: mouseY,
    hue: random(360)
  });
}

function keyPressed() {
  if (key === ' ') {
    points = [];
    for (let i = 0; i < numPoints; i++) {
      points.push({
        x: random(width),
        y: random(height),
        hue: random(360)
      });
    }
  }
}
