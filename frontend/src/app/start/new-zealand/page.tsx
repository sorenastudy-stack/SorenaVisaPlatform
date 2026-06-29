'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';

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

export default function NewZealandPage() {
  return (
    <main className="min-h-screen bg-sorena-cream font-sans text-sorena-text">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 py-16">
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
            New Zealand
          </motion.h1>

          <motion.p
            variants={itemVariants}
            className="mt-5 max-w-xl text-base leading-relaxed text-sorena-text/80 sm:text-lg"
          >
            Your assessment for New Zealand is coming soon. We&apos;re putting the final pieces in place.
          </motion.p>

          <motion.p
            variants={itemVariants}
            className="mt-3 max-w-xl text-base leading-relaxed text-sorena-text/60 sm:text-lg"
          >
            In a moment you&apos;ll answer a few quick questions so we can match you to the right pathway.
          </motion.p>

          <motion.div variants={itemVariants} className="mt-12 w-full sm:w-auto">
            <Link
              href="/scorecard/landing"
              className="group flex min-h-[3rem] w-full items-center justify-center rounded-xl bg-sorena-gold px-10 py-3.5 text-sorena-navy shadow-md transition-all duration-300 hover:-translate-y-0.5 hover:bg-sorena-gold/90 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-sorena-navy focus-visible:ring-offset-2 focus-visible:ring-offset-sorena-cream sm:w-auto sm:min-w-[20rem]"
            >
              <span className="text-base font-semibold sm:text-lg">
                Start my assessment
              </span>
            </Link>
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="mt-6 text-sm text-sorena-text/60"
          >
            <Link
              href="/start"
              className="font-semibold text-sorena-navy underline decoration-sorena-navy/30 decoration-2 underline-offset-4 transition-colors hover:text-sorena-gold hover:decoration-sorena-gold"
            >
              Back to country selection
            </Link>
          </motion.div>
        </motion.div>
      </div>
    </main>
  );
}
