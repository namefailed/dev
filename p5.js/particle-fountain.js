// Particle Fountain - 3D particle fountain

let particles = [];
let maxParticles = 500;

function setup() {
  createCanvas(600, 400, WEBGL);
}

function draw() {
  background(30);
  
  // Lighting
  ambientLight(100);
  directionalLight(255, 255, 255, 0.5, 0.5, -1);
  pointLight(255, 200, 150, 0, -100, 100);
  
  // Rotate view
  rotateX(-PI / 6);
  rotateY(frameCount * 0.005);
  
  // Add new particles
  for (let i = 0; i < 5; i++) {
    particles.push(new Particle());
  }
  
  // Limit particle count
  if (particles.length > maxParticles) {
    particles.splice(0, particles.length - maxParticles);
  }
  
  // Update and display particles
  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update();
    particles[i].display();
    
    if (particles[i].isDead()) {
      particles.splice(i, 1);
    }
  }
  
  // Instructions (2D overlay)
  push();
  resetMatrix();
  camera();
  noLights();
  fill(200);
  noStroke();
  textSize(12);
  text('3D particle fountain', -280, -180);
  text(`Particles: ${particles.length}`, -280, -165);
  pop();
}

class Particle {
  constructor() {
    this.pos = createVector(random(-20, 20), 100, random(-20, 20));
    this.vel = createVector(random(-2, 2), random(-8, -12), random(-2, 2));
    this.acc = createVector(0, 0.3, 0); // gravity
    this.life = 255;
    this.hue = random(30, 60); // orange/yellow range
    this.size = random(3, 8);
  }
  
  update() {
    this.vel.add(this.acc);
    this.pos.add(this.vel);
    this.life -= 3;
    this.size *= 0.99;
  }
  
  display() {
    noStroke();
    fill(this.hue, 80, 100, this.life / 255);
    push();
    translate(this.pos.x, this.pos.y, this.pos.z);
    sphere(this.size);
    pop();
  }
  
  isDead() {
    return this.life <= 0 || this.pos.y > 200;
  }
}
