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

export default function Home() {
  return (
    <main
      dir="rtl"
      className="min-h-screen bg-sorena-cream font-vazirmatn text-sorena-text"
    >
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
            Sorena Visa
          </motion.div>

          <motion.h1
            variants={itemVariants}
            className="mt-6 text-3xl font-bold leading-tight text-sorena-navy sm:text-4xl md:text-5xl"
          >
            مسیر تحصیل و مهاجرتت، شفاف و مطمئن
          </motion.h1>

          <motion.p
            variants={itemVariants}
            className="mt-3 font-sans text-base leading-relaxed text-sorena-text/60 sm:text-lg"
          >
            Your study and migration pathway — clear and trusted
          </motion.p>

          <motion.p
            variants={itemVariants}
            className="mt-10 max-w-2xl text-base leading-loose text-sorena-text/85 sm:text-lg"
          >
            ما Education Agent هستیم. پذیرش دانشگاه و ثبت ویزای تحصیلی برای نیوزیلند و مالزی رایگان است.
            تنها هزینه، ۲۰۰ دلار فعال‌سازی حساب پس از تأیید مسیر توست.
          </motion.p>

          <motion.p
            variants={itemVariants}
            className="mt-3 max-w-2xl font-sans text-sm leading-relaxed text-sorena-text/55 sm:text-base"
          >
            We&apos;re an Education Agent. University admission and student visa filing for New Zealand
            and Malaysia are free. The only cost is a $200 account activation after your pathway is confirmed.
          </motion.p>

          <motion.div variants={itemVariants} className="mt-12 w-full sm:w-auto">
            <Link
              href="/start"
              className="group flex min-h-[3.25rem] w-full flex-col items-center justify-center gap-1 rounded-xl bg-sorena-navy px-10 py-3.5 text-white shadow-md transition-all duration-300 hover:-translate-y-0.5 hover:bg-sorena-navy/95 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-sorena-gold focus-visible:ring-offset-2 focus-visible:ring-offset-sorena-cream sm:w-auto sm:min-w-[20rem]"
            >
              <span className="text-base font-semibold sm:text-lg">
                ارزیابی رایگان را شروع کن
              </span>
              <span className="font-sans text-[11px] uppercase tracking-[0.18em] text-white/70 sm:text-xs">
                Start your free assessment
              </span>
            </Link>
          </motion.div>

          <motion.div
            variants={itemVariants}
            className="mt-10 text-sm text-sorena-text/60"
          >
            <span>قبلاً حساب داری؟ </span>
            <Link
              href="/login"
              className="font-semibold text-sorena-navy underline decoration-sorena-navy/30 decoration-2 underline-offset-4 transition-colors hover:text-sorena-gold hover:decoration-sorena-gold"
            >
              ورود
            </Link>
            <span className="mx-2 text-sorena-text/30" aria-hidden>
              ·
            </span>
            <span className="font-sans text-sorena-text/55">
              Already have an account?{' '}
              <Link
                href="/login"
                className="font-semibold text-sorena-navy underline decoration-sorena-navy/30 decoration-2 underline-offset-4 transition-colors hover:text-sorena-gold hover:decoration-sorena-gold"
              >
                Log in
              </Link>
            </span>
          </motion.div>
        </motion.div>
      </div>
    </main>
  );
}
