// vad.js
const fvadLoader = require('@echogarden/fvad-wasm').default;

// This will cache the fully initialized class after the first run.
let memoizedVadClass = null;

/**
 * Main export. Asynchronously loads the VAD module, defines the Vad class
 * within a closure, and returns the fully configured class.
 * @returns {Promise<typeof Vad>} A promise that resolves to the Vad class constructor.
 */
async function initialize() {
	if (memoizedVadClass) {
		return memoizedVadClass;
	}

	// 1. Load the module and create the API object in local scope.
	const vadModule = await fvadLoader();
	// THE FIX: Remove the leading underscore '_' from all function names.
	const api = {
		new: vadModule.cwrap('fvad_new', 'number', []),
		free: vadModule.cwrap('fvad_free', null, ['number']),
		set_mode: vadModule.cwrap('fvad_set_mode', 'number', ['number', 'number']),
		set_sample_rate: vadModule.cwrap('fvad_set_sample_rate', 'number', ['number', 'number']),
		process: vadModule.cwrap('fvad_process', 'number', ['number', 'number', 'number']),
	};

	// 2. Define the class INSIDE this function's scope.
	// It now has guaranteed access to `vadModule` and `api` through its closure.
	class Vad {
		constructor(sampleRate, mode) {
			this.ptr = api.new();
			if (!this.ptr) {
				throw new Error('Failed to create VAD instance in WASM.');
			}

			this.destroyed = false;

			if (api.set_sample_rate(this.ptr, sampleRate) < 0) {
				api.free(this.ptr);
				throw new Error(`Invalid sample rate for VAD: ${sampleRate}`);
			}
			if (api.set_mode(this.ptr, mode) < 0) {
				api.free(this.ptr);
				throw new Error(`Invalid mode for VAD: ${mode}`);
			}
		}

		process(pcm16) {
			if (this.destroyed) {
				throw new Error('Cannot process audio on a destroyed VAD instance.');
			}
			const bufferPtr = vadModule._malloc(pcm16.length * pcm16.BYTES_PER_ELEMENT);
			vadModule.HEAP16.set(pcm16, bufferPtr / 2);

			const result = api.process(this.ptr, bufferPtr, pcm16.length);

			vadModule._free(bufferPtr);

			if (result < 0) {
				console.error('VAD processing failed with an error code.');
				return false;
			}
			return result === 1;
		}

		destroy() {
			if (!this.destroyed && api.free) {
				api.free(this.ptr);
				this.ptr = null;
				this.destroyed = true;
			}
		}
	}

	// 3. Cache and return the fully configured class.
	memoizedVadClass = Vad;
	return memoizedVadClass;
}

module.exports = { initialize };
