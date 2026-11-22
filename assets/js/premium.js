/* Nexora landing — navigation, reveals, FAQ, enquiry form. No dependencies. */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Header + nav */
  var header = document.getElementById('site-header');
  var nav = document.getElementById('nav');
  var toggle = document.getElementById('nav-toggle');

  function onScroll() {
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 8);
  }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  function closeNav(restoreFocus) {
    if (!nav || !toggle) return;
    var wasOpen = nav.classList.contains('is-open');
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Open menu');
    if (wasOpen && restoreFocus) toggle.focus();
  }
  if (nav && toggle) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
      if (open) {
        var first = nav.querySelector('a');
        if (first) window.setTimeout(function () { first.focus(); }, 200);
      }
    });
    nav.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { closeNav(false); }); });
    document.addEventListener('click', function (e) {
      if (!nav.contains(e.target) && !toggle.contains(e.target)) closeNav(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) closeNav(true);
    });
    window.addEventListener('resize', function () { if (window.innerWidth > 860) closeNav(false); });
  }

  /* Scroll reveal */
  var reveals = document.querySelectorAll('.reveal');
  if (reduced || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var observer = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -5% 0px' });
    reveals.forEach(function (el) { observer.observe(el); });
  }

  /* Active nav link */
  if ('IntersectionObserver' in window) {
    var links = Array.prototype.slice.call(document.querySelectorAll('.nav > a[href^="#"]'));
    var sections = links.map(function (a) { return document.querySelector(a.getAttribute('href')); }).filter(Boolean);
    var navObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        links.forEach(function (a) {
          var active = a.getAttribute('href') === '#' + entry.target.id;
          a.classList.toggle('is-active', active);
          if (active) a.setAttribute('aria-current', 'location');
          else a.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function (s) { navObserver.observe(s); });
  }

  /* FAQ accordion */
  document.querySelectorAll('.faq-q').forEach(function (btn, index) {
    var answer = btn.nextElementSibling;
    if (!answer) return;
    if (!answer.id) answer.id = 'faq-answer-' + (index + 1);
    btn.setAttribute('aria-controls', answer.id);
    var expanded = btn.getAttribute('aria-expanded') === 'true';
    answer.inert = !expanded;
    answer.setAttribute('aria-hidden', String(!expanded));
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      answer.inert = !open;
      answer.setAttribute('aria-hidden', String(!open));
    });
  });

  /* Enquiry form -> real API */
  var form = document.getElementById('enquiry-form');
  var status = document.getElementById('enquiry-status');
  if (form && status) {
    var fields = Array.prototype.slice.call(form.querySelectorAll('input, textarea'));

    function setError(field, message) {
      var id = field.id + '-error';
      var old = document.getElementById(id);
      if (old) old.remove();
      field.setAttribute('aria-invalid', String(Boolean(message)));
      var described = (field.getAttribute('aria-describedby') || '').split(/\s+/).filter(function (value) {
        return value && value !== id;
      });
      if (message) {
        var span = document.createElement('span');
        span.className = 'field-error';
        span.id = id;
        span.textContent = message;
        field.insertAdjacentElement('afterend', span);
        described.push(id);
      }
      if (described.length) field.setAttribute('aria-describedby', described.join(' '));
      else field.removeAttribute('aria-describedby');
    }

    fields.forEach(function (field) {
      field.addEventListener('input', function () {
        if (field.getAttribute('aria-invalid') === 'true') setError(field, '');
      });
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var payload = {};
      var firstBad = null;

      fields.forEach(function (field) {
        var value = field.value.trim();
        payload[field.name] = value;
        var message = !value ? 'Please fill this in.' :
          (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? 'Enter a valid email.' : '');
        setError(field, message);
        if (message && !firstBad) firstBad = field;
      });

      if (firstBad) {
        status.setAttribute('aria-live', 'assertive');
        status.textContent = 'Check the highlighted fields.';
        status.classList.add('is-error');
        firstBad.focus();
        return;
      }

      var button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      form.setAttribute('aria-busy', 'true');
      status.setAttribute('aria-live', 'polite');
      status.classList.remove('is-error');
      status.textContent = 'Sending…';

      try {
        var response = await fetch('/api/enquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not send.');
        status.textContent = 'Received. Reference ' + data.ref + ' — we will be in touch shortly.';
        form.reset();
      } catch (error) {
        status.setAttribute('aria-live', 'assertive');
        status.classList.add('is-error');
        status.textContent = error.message || 'Something went wrong. Please try again.';
      } finally {
        form.removeAttribute('aria-busy');
        button.disabled = false;
      }
    });
  }

  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
