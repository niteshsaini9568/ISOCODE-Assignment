'use client';
import { useEffect, useRef } from 'react';
import { fragmentShader } from './mosaic-reference.js';

export default function MosaicBackground({ scroll = false }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!gl) return;
    const shaders = [];
    let program, buffer, frame = 0;
    const release = () => {
      cancelAnimationFrame(frame);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      shaders.forEach(shader => gl.deleteShader(shader));
    };
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Shader unavailable');
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader compilation failed');
      return shader;
    };
    try {
      const vertex = compile(gl.VERTEX_SHADER, 'attribute vec2 aPos;void main(){gl_Position=vec4(aPos,0.,1.);}');
      const fragment = compile(gl.FRAGMENT_SHADER, fragmentShader);
      program = gl.createProgram();
      gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader linking failed');
      gl.useProgram(program); buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'aPos');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const uniforms = Object.fromEntries(['uRes','uTime','uMix','uAccent','uPtr','uPtrOn','uColorStrength'].map(key => [key, gl.getUniformLocation(program, key)]));
      gl.uniform3f(uniforms.uAccent, ...(scroll ? [.48, .60, 1] : [.75, .75, .75]));
      gl.uniform1f(uniforms.uColorStrength, scroll ? .78 : 0);
      const motion = matchMedia('(prefers-reduced-motion: reduce)');
      let dirty = true, previous = 0, pointer = [0, 0], pointerOn = 0;
      const resize = () => {
        const scale = Math.min(devicePixelRatio || 1, 1.5) * .75;
        canvas.width = Math.max(1, Math.round(innerWidth * scale)); canvas.height = Math.max(1, Math.round(innerHeight * scale));
        gl.viewport(0, 0, canvas.width, canvas.height); dirty = true;
      };
      const invalidate = () => { dirty = true; };
      const move = event => { pointer = [event.clientX / innerHeight, 1 - event.clientY / innerHeight]; pointerOn = 1; dirty = true; };
      const leave = () => { pointerOn = 0; dirty = true; };
      const draw = now => {
        frame = requestAnimationFrame(draw);
        if (document.hidden || gl.isContextLost() || (motion.matches && !dirty) || now - previous < 33) return;
        previous = now; dirty = false;
        const progress = id => { const section = document.getElementById(id); return section ? Math.max(0, Math.min(1, (innerHeight * .85 - section.getBoundingClientRect().top) / (innerHeight * .65))) : 0; };
        gl.uniform2f(uniforms.uRes, canvas.width, canvas.height);
        gl.uniform1f(uniforms.uTime, motion.matches ? 12 : now / 1000);
        gl.uniform1f(uniforms.uMix, scroll ? progress('workflow') + progress('trust') : 0);
        gl.uniform2f(uniforms.uPtr, ...pointer); gl.uniform1f(uniforms.uPtrOn, motion.matches ? 0 : pointerOn);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      const lose = event => { event.preventDefault(); canvas.style.opacity = '0'; cancelAnimationFrame(frame); };
      resize(); frame = requestAnimationFrame(draw);
      window.addEventListener('resize', resize); window.addEventListener('scroll', invalidate, { passive: true });
      window.addEventListener('pointermove', move, { passive: true }); document.documentElement.addEventListener('pointerleave', leave);
      motion.addEventListener('change', invalidate); canvas.addEventListener('webglcontextlost', lose);
      return () => {
        window.removeEventListener('resize', resize); window.removeEventListener('scroll', invalidate);
        window.removeEventListener('pointermove', move); document.documentElement.removeEventListener('pointerleave', leave);
        motion.removeEventListener('change', invalidate); canvas.removeEventListener('webglcontextlost', lose); release();
      };
    } catch { release(); }
  }, [scroll]);
  return <div className="mosaic-background" aria-hidden="true"><canvas ref={canvasRef}/></div>;
}
