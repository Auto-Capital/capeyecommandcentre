// ══════════════════════════════════════════════════════════════════════
// CapEye — Mobile Menu — BOX-STYLE OVERLAY
// Adds a ☰ button on small screens. Tapping it opens a full-screen overlay
// with the nav items as a 2-column grid of tappable tiles. Works on any
// page by cloning that page's existing .nav-links. No desktop impact.
// ══════════════════════════════════════════════════════════════════════
(function () {
  function init() {
    var nav = document.querySelector('nav.nav') || document.querySelector('nav') || document.querySelector('.nav');
    var links = nav && nav.querySelector('.nav-links');
    if (!nav) return;
    if (document.getElementById('ceHamburger')) return;

    var btn = document.createElement('button');
    btn.id = 'ceHamburger'; btn.className = 'ce-hamburger';
    btn.setAttribute('aria-label', 'Menu');
    btn.innerHTML = '<i class="fas fa-bars"></i>';
    var brand = nav.querySelector('.nav-brand') || nav.querySelector('.back-btn');
    if (brand && brand.nextSibling) nav.insertBefore(btn, brand.nextSibling);
    else nav.insertBefore(btn, nav.firstChild);

    var overlay = document.createElement('div');
    overlay.className = 'ce-nav-overlay'; overlay.id = 'ceNavOverlay';
    var close = document.createElement('button');
    close.className = 'ce-nav-close'; close.innerHTML = '<i class="fas fa-times"></i>';
    close.setAttribute('aria-label', 'Close menu');
    var title = document.createElement('div');
    title.className = 'ce-nav-title'; title.textContent = 'CapEye Menu';
    var grid = document.createElement('div'); grid.className = 'ce-nav-grid';

    var built = false;
    if (links) {
      links.querySelectorAll('a').forEach(function (a) {
        var tile = document.createElement('a');
        tile.href = a.getAttribute('href');
        tile.innerHTML = a.innerHTML;
        if (a.classList.contains('active')) tile.classList.add('active');
        grid.appendChild(tile); built = true;
      });
    }
    if (!built) {
      [['index.html','fa-gauge-high','Dashboard'],['workflow.html','fa-arrows-rotate','Workflow'],
       ['inventory.html','fa-car','Inventory'],['alerts.html','fa-bell','Alerts'],
       ['analytics.html','fa-chart-bar','Analytics'],['keys.html','fa-key','Keys'],
       ['auction.html','fa-gavel','Auction'],['accessories.html','fa-wrench','Accessories'],
       ['aftersales.html','fa-headset','Aftersales'],['staff-jobs.html','fa-clipboard-list','Staff Jobs'],
       ['import.html','fa-file-import','Import'],['audit.html','fa-list-check','Audit'],
       ['team.html','fa-users','Team'],['admin.html','fa-cog','Admin']
      ].forEach(function (m) {
        var tile = document.createElement('a');
        tile.href = m[0]; tile.innerHTML = '<i class="fas ' + m[1] + '"></i> ' + m[2];
        grid.appendChild(tile);
      });
    }

    overlay.appendChild(close); overlay.appendChild(title); overlay.appendChild(grid);
    document.body.appendChild(overlay);

    function open()  { overlay.classList.add('ce-show'); document.body.style.overflow = 'hidden'; }
    function shut()  { overlay.classList.remove('ce-show'); document.body.style.overflow = ''; }
    btn.addEventListener('click', open);
    close.addEventListener('click', shut);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) shut(); });
    window.addEventListener('resize', function () { if (window.innerWidth > 768) shut(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
