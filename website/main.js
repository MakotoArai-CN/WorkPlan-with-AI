(function () {
    const header = document.querySelector('.site-header');
    const nav = document.querySelector('.site-nav');
    const toggle = document.querySelector('.nav-toggle');

    if (toggle && nav) {
        toggle.addEventListener('click', () => {
            const open = nav.classList.toggle('open');
            toggle.setAttribute('aria-expanded', String(open));
        });
        nav.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', () => {
                nav.classList.remove('open');
                toggle.setAttribute('aria-expanded', 'false');
            });
        });
        document.addEventListener('click', (event) => {
            if (!nav.classList.contains('open')) return;
            if (nav.contains(event.target) || toggle.contains(event.target)) return;
            nav.classList.remove('open');
            toggle.setAttribute('aria-expanded', 'false');
        });
    }

    if (header) {
        const updateHeader = () => header.classList.toggle('scrolled', window.scrollY > 12);
        updateHeader();
        window.addEventListener('scroll', updateHeader, { passive: true });
    }

    const revealItems = document.querySelectorAll('[data-reveal]');
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        revealItems.forEach((item) => item.classList.add('visible'));
        return;
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    revealItems.forEach((item, index) => {
        item.style.transitionDelay = `${Math.min(index * 40, 240)}ms`;
        observer.observe(item);
    });
})();
