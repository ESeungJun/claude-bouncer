'use strict'
// What the main process needs to know about the OS it runs on, in one place.
// lib/ takes the platform as an argument instead (so its tests can pick one),
// and the renderer asks through state:get.
const IS_MAC = process.platform === 'darwin'

module.exports = { IS_MAC }
