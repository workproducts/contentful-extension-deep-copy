function log (str) {
  if (window) {
    const ce = new CustomEvent('deepcopylog', {
      detail: {
        log: str
      }
    })
    window.dispatchEvent(ce)
  }
  if (console) {
    console.log(str)
  }
}

export {
  log
}