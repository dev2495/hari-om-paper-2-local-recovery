/**
 * Theme boot script for the root layout (no React here: the root layout is a server component).
 * See lib/theme.ts for the controls.
 */
export const THEME_KEY = "hariom_theme_v1"

/**
 * Runs in <head> before the first paint so the page never flashes the wrong theme, and keeps
 * following the device while the saved choice is "system". Printing always uses the light theme
 * (paper is white), then the screen theme comes back. Plain string: it runs before React.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,m=matchMedia("(prefers-color-scheme: dark)"),s=function(){var t=localStorage.getItem("${THEME_KEY}");return t==="light"||t==="dark"?t:"system"};var r=function(){var c=s();d.dataset.theme=c==="system"?(m.matches?"dark":"light"):c;d.dataset.themeChoice=c};r();m.addEventListener&&m.addEventListener("change",function(){if(s()==="system")r()});addEventListener("beforeprint",function(){d.dataset.screenTheme=d.dataset.theme;d.dataset.theme="light"});addEventListener("afterprint",function(){if(d.dataset.screenTheme)d.dataset.theme=d.dataset.screenTheme;delete d.dataset.screenTheme});d.dataset.density=localStorage.getItem("hariom_density_v1")==="compact"?"compact":"comfortable"}catch(e){}})()`
