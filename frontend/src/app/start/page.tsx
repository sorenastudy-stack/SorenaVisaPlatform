'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

const countries = [
  {
    href: '/start/new-zealand',
    flag: '🇳🇿',
    name: 'New Zealand',
  },
  {
    href: '/start/malaysia',
    flag: '🇲🇾',
    name: 'Malaysia',
  },
] as const;

const containerVariants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 24 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } },
};

export default function StartPage() {
  return (
    <main className="min-h-screen bg-sorena-cream font-sans text-sorena-text">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-6 py-16">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="flex w-full flex-col items-center text-center"
        >
          <motion.h1
            variants={itemVariants}
            className="text-3xl font-bold leading-tight text-sorena-navy sm:text-4xl md:text-5xl"
          >
            Which country are you interested in?
          </motion.h1>

          <motion.p
            variants={itemVariants}
            className="mt-5 max-w-xl text-base leading-relaxed text-sorena-text/80 sm:text-lg"
          >
            Start your journey here. We&apos;re with you at every step.
          </motion.p>

          <motion.div
            variants={containerVariants}
            className="mt-12 grid w-full grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6"
          >
            {countries.map((c) => (
              <motion.div key={c.href} variants={itemVariants}>
                <Link
                  href={c.href}
                  className="group flex min-h-[12rem] flex-col items-center justify-center gap-3 rounded-xl border border-sorena-navy/10 bg-white px-6 py-8 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-sorena-gold/60 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-sorena-gold focus-visible:ring-offset-2 focus-visible:ring-offset-sorena-cream"
                >
                  <span
                    aria-hidden
                    className="text-5xl leading-none transition-transform duration-300 group-hover:scale-110 sm:text-6xl"
                  >
                    {c.flag}
                  </span>
                  <span className="text-xl font-semibold text-sorena-navy sm:text-2xl">
                    {c.name}
                  </span>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </main>
  );
}
