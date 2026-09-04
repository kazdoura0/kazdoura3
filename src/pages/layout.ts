/** Shared HTML document wrapper */
export function layout(opts: { title: string; body: string; scripts: string[]; styles?: string[]; bodyClass?: string; extraHead?: string }): string {
  const styles = (opts.styles || []).map((s) => `<link rel="stylesheet" href="${s}">`).join('\n')
  const scripts = opts.scripts.map((s) => `<script src="${s}"></script>`).join('\n')
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#1f1b16">
<title>${opts.title}</title>
<script>(function(){try{var t=localStorage.getItem('kz_theme');if(!t&&window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches)t='dark';if(t==='dark'){document.documentElement.setAttribute('data-theme','dark');var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content','#0f0d0b')}}catch(e){}})()</script>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.2/css/all.min.css" rel="stylesheet">
<link rel="stylesheet" href="/static/base.css">
${styles}
${opts.extraHead || ''}
</head>
<body class="${opts.bodyClass || ''}">
${opts.body}
${scripts}
</body>
</html>`
}
