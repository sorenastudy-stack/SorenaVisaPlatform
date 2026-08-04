'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { SplashGate } from '@/components/loader/SplashGate';

// Demo-only override: when NEXT_PUBLIC_ASSESSMENT_LIVE=true (set ONLY on the demo
// Railway env), the funnel entry points at the v2 (31-question) assessment. Prod
// never sets this flag, so it keeps routing to /start → the live /scorecard form.
// This does NOT change the production go-live gate (Phase 33 — Yashua's call).
const ASSESSMENT_LIVE = process.env.NEXT_PUBLIC_ASSESSMENT_LIVE === 'true';
const ASSESSMENT_ENTRY = ASSESSMENT_LIVE ? '/assessment' : '/start';

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

export default function Home() {
  return (
    <>
      {/* PR-GLOBE-LOADER — first-open splash that fades into the landing page. */}
      <SplashGate />
    <main className="min-h-screen bg-sorena-cream font-sans text-sorena-text">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="show"
          className="flex w-full flex-col items-center text-center"
        >
          <motion.div
            variants={itemVariants}
            className="text-sm font-semibold uppercase tracking-[0.2em] text-sorena-gold"
          >
            SORENA VISA
          </motion.div>

          <motion.h1
            variants={itemVariants}
            className="mt-6 text-3xl font-bold leading-tight text-sorena-navy sm:text-4xl md:text-5xl"
          >
            Your study and migration pathway — clear and trusted
          </motion.h1>

          <motion.p
            variants={itemVariants}
            className="mt-10 max-w-2xl text-base leading-loose text-sorena-text/85 sm:text-lg"
          >
            We&apos;re an Education and Immigration Agent. University admission and student visa filing for New Zealand
            and Malaysia are free. The only cost is a $200 account activation after your pathway is confirmed.
          </motion.p>

          <motion.div variants={itemVariants} className="mt-12 w-full sm:w-auto">
            <Link
              href={ASSESSMENT_ENTRY}
              className="group flex min-h-[3rem] w-full items-center justify-center rounded-xl bg-sorena-gold px-10 py-3.5 text-sorena-navy shadow-md transition-all duration-300 hover:-translate-y-0.5 hover:bg-sorena-gold/90 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-sorena-navy focus-visible:ring-offset-2 focus-visible:ring-offset-sorena-cream sm:w-auto sm:min-w-[20rem]"
            >
              <span className="text-base font-semibold sm:text-lg">
                Start your free assessment
              </span>
            </Link>
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="mt-10 text-sm text-sorena-text/60"
          >
            Already have an account?{' '}
            <Link
              href="/login"
              className="font-semibold text-sorena-navy underline decoration-sorena-navy/30 decoration-2 underline-offset-4 transition-colors hover:text-sorena-gold hover:decoration-sorena-gold"
            >
              Log in
            </Link>
          </motion.div>
        </motion.div>
      </div>
    </main>
    </>
  );
}
