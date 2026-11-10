'use strict';
// Preload de pruebas: permite exclusivamente TCP de loopback. No usa credenciales.
const net = require('node:net');
const conectar = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const opciones = net._normalizeArgs(args)[0];
  const host = opciones.host || 'localhost';
  if (!['localhost', '127.0.0.1', '::1'].includes(host) || opciones.path) {
    throw new Error('UNEFIBRA-041: conexión externa bloqueada por el entorno de pruebas');
  }
  return conectar.apply(this, args);
};
