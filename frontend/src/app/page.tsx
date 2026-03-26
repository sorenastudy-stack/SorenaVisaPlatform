import LeadForm from '@/components/LeadForm';

export default function HomePage() {
  return (
    <>
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --navy: #0a2342;
          --teal: #0d7a6e;
          --teal-light: #12a693;
          --white: #ffffff;
          --off-white: #f4f7f6;
          --text: #2c3e50;
          --text-light: #5a6a7a;
        }
        body { font-family: 'Segoe UI', sans-serif; color: var(--text); background: var(--white); }
        a { text-decoration: none; }
        nav { position: fixed; top: 0; left: 0; right: 0; z-index: 100; display: flex; justify-content: space-between; align-items: center; padding: 18px 60px; background: rgba(10,35,66,0.95); backdrop-filter: blur(8px); }
        .logo { font-size: 1.5rem; font-weight: 700; color: #fff; letter-spacing: 1px; }
        .logo span { color: var(--teal-light); }
        nav ul { list-style: none; display: flex; gap: 32px; }
        nav ul a { color: rgba(255,255,255,0.85); font-size: 0.95rem; transition: color 0.2s; }
        nav ul a:hover { color: var(--teal-light); }
        .nav-cta { background: var(--teal); color: var(--white) !important; padding: 10px 22px; border-radius: 6px; font-weight: 600 !important; }
        .nav-cta:hover { background: var(--teal-light) !important; }
        .hero { min-height: 100vh; background: linear-gradient(135deg, var(--navy) 0%, #0d4f6e 60%, #0a7a6e 100%); display: flex; align-items: center; justify-content: center; text-align: center; padding: 100px 24px 60px; }
        .hero-badge { display: inline-block; background: rgba(13,122,110,0.4); border: 1px solid rgba(18,166,147,0.5); color: var(--teal-light); font-size: 0.8rem; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; padding: 6px 18px; border-radius: 20px; margin-bottom: 24px; }
        .hero h1 { font-size: clamp(2.2rem, 5vw, 3.8rem); font-weight: 800; color: #fff; line-height: 1.15; margin-bottom: 20px; }
        .hero h1 span { color: var(--teal-light); }
        .hero p { font-size: 1.15rem; color: rgba(255,255,255,0.75); max-width: 560px; margin: 0 auto 40px; line-height: 1.7; }
        .hero-buttons { display: flex; gap: 16px; justify-content: center; flex-wrap: wrap; }
        .btn-primary { background: var(--teal); color: var(--white); padding: 15px 36px; border-radius: 8px; font-weight: 700; font-size: 1rem; transition: background 0.2s, transform 0.2s; display: inline-block; }
        .btn-primary:hover { background: var(--teal-light); transform: translateY(-2px); }
        .btn-outline { border: 2px solid rgba(255,255,255,0.5); color: var(--white); padding: 15px 36px; border-radius: 8px; font-weight: 600; font-size: 1rem; transition: border-color 0.2s, transform 0.2s; display: inline-block; }
        .btn-outline:hover { border-color: var(--teal-light); transform: translateY(-2px); }
        .stats { background: var(--white); display: flex; justify-content: center; flex-wrap: wrap; box-shadow: 0 4px 30px rgba(0,0,0,0.08); }
        .stat { flex: 1; min-width: 160px; text-align: center; padding: 36px 24px; border-right: 1px solid #eef0f2; }
        .stat:last-child { border-right: none; }
        .stat-number { font-size: 2.4rem; font-weight: 800; color: var(--teal); }
        .stat-label { font-size: 0.88rem; color: var(--text-light); margin-top: 4px; }
        section { padding: 90px 24px; }
        .section-tag { text-transform: uppercase; letter-spacing: 2px; font-size: 0.78rem; font-weight: 700; color: var(--teal); margin-bottom: 10px; }
        h2 { font-size: clamp(1.8rem, 3vw, 2.6rem); font-weight: 800; color: var(--navy); margin-bottom: 16px; }
        .section-intro { font-size: 1.05rem; color: var(--text-light); max-width: 560px; line-height: 1.7; }
        .container { max-width: 1100px; margin: 0 auto; }
        #services { background: var(--off-white); }
        .services-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 28px; margin-top: 56px; }
        .service-card { background: var(--white); border-radius: 12px; padding: 36px 32px; box-shadow: 0 2px 16px rgba(0,0,0,0.06); transition: transform 0.25s, box-shadow 0.25s; }
        .service-card:hover { transform: translateY(-6px); box-shadow: 0 10px 32px rgba(0,0,0,0.1); }
        .service-icon { font-size: 2.4rem; margin-bottom: 18px; }
        .service-card h3 { font-size: 1.2rem; font-weight: 700; color: var(--navy); margin-bottom: 10px; }
        .service-card p { font-size: 0.95rem; color: var(--text-light); line-height: 1.65; }
        .why-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; align-items: center; margin-top: 56px; }
        .why-list { list-style: none; }
        .why-list li { display: flex; gap: 16px; margin-bottom: 28px; }
        .why-icon { flex-shrink: 0; width: 46px; height: 46px; background: linear-gradient(135deg, var(--teal), var(--teal-light)); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; }
        .why-text h4 { font-weight: 700; color: var(--navy); margin-bottom: 4px; }
        .why-text p { font-size: 0.93rem; color: var(--text-light); line-height: 1.6; }
        .why-visual { background: linear-gradient(135deg, var(--navy), #0d4f6e); border-radius: 16px; padding: 50px 40px; color: var(--white); text-align: center; }
        .why-visual .big-text { font-size: 5rem; font-weight: 800; color: var(--teal-light); line-height: 1; }
        #process { background: var(--off-white); }
        .process-steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 24px; margin-top: 56px; }
        .step { text-align: center; padding: 32px 20px; }
        .step-number { width: 54px; height: 54px; background: linear-gradient(135deg, var(--teal), var(--teal-light)); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; font-weight: 800; color: var(--white); margin: 0 auto 18px; }
        .step h4 { font-weight: 700; color: var(--navy); margin-bottom: 8px; }
        .step p { font-size: 0.9rem; color: var(--text-light); line-height: 1.6; }
        #contact { background: var(--navy); color: var(--white); }
        #contact h2 { color: var(--white); }
        #contact .section-intro { color: rgba(255,255,255,0.65); }
        .contact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; margin-top: 56px; align-items: start; }
        .contact-info { display: flex; flex-direction: column; gap: 24px; }
        .contact-item { display: flex; gap: 16px; align-items: flex-start; }
        .contact-item-icon { font-size: 1.4rem; margin-top: 2px; }
        .contact-item h4 { font-weight: 600; color: var(--teal-light); margin-bottom: 2px; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 1px; }
        .contact-item p { color: rgba(255,255,255,0.75); font-size: 0.97rem; }
        footer { background: #060f1a; color: rgba(255,255,255,0.5); text-align: center; padding: 28px 24px; font-size: 0.88rem; }
        footer span { color: var(--teal-light); }
        @media (max-width: 768px) {
          nav { padding: 16px 24px; }
          nav ul { display: none; }
          .why-grid, .contact-grid { grid-template-columns: 1fr; }
          .stat { border-right: none; border-bottom: 1px solid #eef0f2; }
          .stat:last-child { border-bottom: none; }
        }
      `}</style>

      {/* NAV */}
      <nav>
        <div className="logo">Sorena<span>Visa</span></div>
        <ul>
          <li><a href="#services">Services</a></li>
          <li><a href="#why">Why Us</a></li>
          <li><a href="#process">Process</a></li>
          <li><a href="#contact" className="nav-cta">Free Consultation</a></li>
        </ul>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div style={{ position: 'relative', maxWidth: '800px' }}>
          <div className="hero-badge">New Zealand Licensed Immigration Adviser</div>
          <h1>Your Pathway to<br /><span>Study & Live in New Zealand</span></h1>
          <p>Sorena Visa specialises in education and migration services, guiding students and families through every step of their New Zealand journey.</p>
          <div className="hero-buttons">
            <a href="#contact" className="btn-primary">Get Free Consultation</a>
            <a href="#services" className="btn-outline">Our Services</a>
          </div>
        </div>
      </section>

      {/* STATS */}
      <div className="stats">
        {[
          { number: '500+', label: 'Successful Applications' },
          { number: '98%', label: 'Approval Rate' },
          { number: '10+', label: 'Years Experience' },
          { number: '30+', label: 'Partner Institutions' },
        ].map((s) => (
          <div key={s.label} className="stat">
            <div className="stat-number">{s.number}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* SERVICES */}
      <section id="services">
        <div className="container">
          <div className="section-tag">What We Offer</div>
          <h2>Our Services</h2>
          <p className="section-intro">Whether you&apos;re planning to study or settle in New Zealand, we provide expert guidance tailored to your goals.</p>
          <div className="services-grid">
            {[
              { icon: '🎓', title: 'Student Visa', desc: 'From school to postgraduate study — we handle your student visa application from start to finish, including institution placement.' },
              { icon: '🏠', title: 'Skilled Migrant Visa', desc: 'Qualified professionals looking to make New Zealand home. We assess your eligibility and manage your residency application.' },
              { icon: '💼', title: 'Work Visa', desc: 'Temporary and open work visas for individuals seeking employment opportunities across New Zealand.' },
              { icon: '👨‍👩‍👧', title: 'Family Sponsorship', desc: 'Reunite with loved ones in New Zealand through partner, dependent child, and parent sponsorship visas.' },
              { icon: '🏫', title: 'School & University Placement', desc: 'We partner with leading NZ institutions to match you with the right school or university programme.' },
              { icon: '🌏', title: 'Pathway to Residency', desc: 'Plan your long-term future with a clear pathway from student or work visa to permanent residency.' },
            ].map((s) => (
              <div key={s.title} className="service-card">
                <div className="service-icon">{s.icon}</div>
                <h3>{s.title}</h3>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY US */}
      <section id="why">
        <div className="container">
          <div className="why-grid">
            <div>
              <div className="section-tag">Why Choose Us</div>
              <h2>We Know NZ Immigration Inside Out</h2>
              <ul className="why-list">
                {[
                  { icon: '✅', title: 'Licensed Immigration Advisers', desc: 'Our advisers are fully licensed by the Immigration Advisers Authority (IAA), ensuring professional and ethical service.' },
                  { icon: '🎯', title: 'Personalised Approach', desc: 'No two situations are the same. We tailor every application strategy to your unique background and goals.' },
                  { icon: '🔄', title: 'End-to-End Support', desc: 'From initial assessment to visa grant — we are with you at every step, including pre-departure guidance.' },
                  { icon: '🌐', title: 'Multilingual Team', desc: 'We communicate in your language, removing barriers and ensuring nothing gets lost in translation.' },
                ].map((item) => (
                  <li key={item.title}>
                    <div className="why-icon">{item.icon}</div>
                    <div className="why-text">
                      <h4>{item.title}</h4>
                      <p>{item.desc}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="why-visual">
              <div className="big-text">NZ</div>
              <p>Your new chapter starts here</p>
              <p style={{ marginTop: '24px', fontSize: '0.9rem', opacity: 0.6 }}>Auckland · Wellington · Christchurch</p>
            </div>
          </div>
        </div>
      </section>

      {/* PROCESS */}
      <section id="process">
        <div className="container">
          <div style={{ textAlign: 'center' }}>
            <div className="section-tag">How It Works</div>
            <h2>Simple 4-Step Process</h2>
            <p className="section-intro" style={{ margin: '0 auto' }}>Getting started is easy. We guide you through every stage clearly and transparently.</p>
          </div>
          <div className="process-steps">
            {[
              { n: '1', title: 'Free Consultation', desc: 'Book a no-obligation consultation. We assess your situation and outline your best visa options.' },
              { n: '2', title: 'Document Preparation', desc: 'We provide a clear checklist and review all documents to ensure your application is complete.' },
              { n: '3', title: 'Visa Lodgement', desc: 'We submit your application to Immigration New Zealand and monitor its progress.' },
              { n: '4', title: 'Visa Granted 🎉', desc: 'Once approved, we assist with pre-departure preparation and settling in New Zealand.' },
            ].map((s) => (
              <div key={s.n} className="step">
                <div className="step-number">{s.n}</div>
                <h4>{s.title}</h4>
                <p>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CONTACT */}
      <section id="contact">
        <div className="container">
          <div className="section-tag">Get In Touch</div>
          <h2>Book a Free Consultation</h2>
          <p className="section-intro">Ready to start your New Zealand journey? Reach out today — the first consultation is completely free.</p>
          <div className="contact-grid">
            <div className="contact-info">
              {[
                { icon: '📍', label: 'Location', value: 'Auckland, New Zealand' },
                { icon: '📞', label: 'Phone', value: '+64 (0)9 000 0000' },
                { icon: '✉️', label: 'Email', value: 'info@sorenavisa.co.nz' },
                { icon: '🕐', label: 'Hours', value: 'Mon – Fri: 9:00am – 5:30pm NZST' },
              ].map((item) => (
                <div key={item.label} className="contact-item">
                  <div className="contact-item-icon">{item.icon}</div>
                  <div>
                    <h4>{item.label}</h4>
                    <p>{item.value}</p>
                  </div>
                </div>
              ))}
            </div>
            <LeadForm />
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <p>&copy; 2026 <span>Sorena Visa</span>. All rights reserved. Licensed Immigration Advisers — New Zealand.</p>
      </footer>

      <script dangerouslySetInnerHTML={{
        __html: `document.querySelectorAll('a[href^="#"]').forEach(a=>{a.addEventListener('click',e=>{e.preventDefault();document.querySelector(a.getAttribute('href'))?.scrollIntoView({behavior:'smooth'})})});`
      }} />
    </>
  );
}
