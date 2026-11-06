;(() => {
  const STORAGE_KEY = 'nekolog-mockup-theme'

  function preferred() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved === 'dark' || saved === 'light') {
        return saved
      }
    } catch {}

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }

  function apply(theme) {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }

  apply(preferred())

  document.addEventListener('DOMContentLoaded', () => {
    for (const button of document.querySelectorAll('[data-theme-toggle]')) {
      button.addEventListener('click', () => {
        const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark'
        apply(next)
        try {
          localStorage.setItem(STORAGE_KEY, next)
        } catch {}
      })
    }
  })
})()
