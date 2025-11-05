// Tiny JS for nav + forms
const toggle = document.querySelector('.nav-toggle');
const menu = document.querySelector('[data-menu]');
if (toggle && menu){
  toggle.addEventListener('click', () => {
    const open = menu.getAttribute('data-open') === 'true';
    menu.setAttribute('data-open', String(!open));
    toggle.setAttribute('aria-expanded', String(!open));
  });
}

// Smooth scroll for same-page links
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const id = a.getAttribute('href');
    const el = document.querySelector(id);
    if (el){
      e.preventDefault();
      el.scrollIntoView({behavior:'smooth', block:'start'});
      menu?.setAttribute('data-open','false');
    }
  });
});

// Demo handlers (replace with your backend or Formspree endpoint)
function handleSignup(e){
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  alert('Thanks, ' + data.name + '! We'll email cohort details soon.');
  e.target.reset();
  return false;
}
function handleContact(e){
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target).entries());
  alert('Message sent. Thank you, ' + data.name + '!');
  e.target.reset();
  return false;
}

// Year in footer
document.getElementById('y').textContent = new Date().getFullYear();
