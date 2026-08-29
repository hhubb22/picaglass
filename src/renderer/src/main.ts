import { mount } from 'svelte'

import './assets/main.css'
import App from './App.svelte'

const target = document.getElementById('app')
if (!target) {
  throw new Error('Missing #app element')
}

mount(App, { target })
