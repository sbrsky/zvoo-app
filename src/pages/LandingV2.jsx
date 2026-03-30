import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, useScroll, useTransform, AnimatePresence } from 'framer-motion';
import { Play, TrendingUp, Cpu, Users, Mic, FastForward } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Helmet } from 'react-helmet-async';

const features = [
  {
    icon: <Mic className="w-8 h-8" />,
    title: 'Запись и реверс',
    desc: 'Мгновенная трансформация твоей речи в загадочную «тарабарщину».',
    color: '#7C3AED',
  },
  {
    icon: <Users className="w-8 h-8" />,
    title: 'Realtime Мультиплеер',
    desc: 'Бросай вызов друзьям где угодно с молниеносной синхронизацией.',
    color: '#06B6D4',
  },
  {
    icon: <Cpu className="w-8 h-8" />,
    title: 'AI Судья',
    desc: 'Мощь нейросетей от Gemini для сверхточной оценки твоей имитации.',
    color: '#F43F5E',
  },
];

// Kinetic Typography Component
const AnimatedText = ({ text, className, delay = 0 }) => {
  const words = text.split(' ');

  const container = {
    hidden: { opacity: 0 },
    visible: (i = 1) => ({
      opacity: 1,
      transition: { staggerChildren: 0.12, delayChildren: delay * 0.1 },
    }),
  };

  const child = {
    visible: {
      opacity: 1,
      y: 0,
      rotateX: 0,
      transition: {
        type: 'spring',
        damping: 12,
        stiffness: 100,
      },
    },
    hidden: {
      opacity: 0,
      y: 50,
      rotateX: -90,
      transition: {
        type: 'spring',
        damping: 12,
        stiffness: 100,
      },
    },
  };

  return (
    <motion.div
      style={{ overflow: 'hidden', display: 'flex', flexWrap: 'wrap', perspective: 1000 }}
      variants={container}
      initial="hidden"
      animate="visible"
      className={className}
    >
      {words.map((word, index) => (
        <motion.span
          variants={child}
          style={{ marginRight: '0.25em', display: 'inline-block', transformOrigin: '50% 100%' }}
          key={index}
        >
          {word}
        </motion.span>
      ))}
    </motion.div>
  );
};

export default function LandingV2() {
  const { user } = useAuth();
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end start'],
  });

  const yBg = useTransform(scrollYProgress, [0, 1], ['0%', '50%']);
  const opacityBg = useTransform(scrollYProgress, [0, 1], [1, 0]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      setMousePosition({
        x: e.clientX,
        y: e.clientY,
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <>
    <Helmet>
      <title>EchoFlip AI | Reverse Audio Gamified Challenge 2026</title>
      <meta name="description" content="Твой голос. Обратная перемотка. Искусственный интеллект в роли беспристрастного судьи. Брось вызов реальности в главном лингвистическом тренде 2026 года." />
      <meta property="og:title" content="EchoFlip AI - AI Multi-player Audio Game" />
      <meta property="og:description" content="Мгновенная трансформация твоей речи в загадочную «тарабарщину» с судейством нейросети Gemini." />
      <meta property="og:type" content="website" />
      <meta name="theme-color" content="#05050A" />
      <meta name="robots" content="index, follow" />
      <script type="application/ld+json">
        {`
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            "name": "EchoFlip AI",
            "applicationCategory": "GameApplication",
            "operatingSystem": "Web",
            "description": "AI-мультиплеерная аудио игра с обратной перемоткой звука и оценкой от Gemini."
          }
        `}
      </script>
    </Helmet>
    <main
      ref={containerRef}
      style={{
        minHeight: '100vh',
        backgroundColor: '#05050A',
        color: '#FFFFFF',
        overflow: 'hidden',
        position: 'relative',
        fontFamily: '"Inter", "Outfit", sans-serif',
      }}
    >
      {/* Dynamic Cursor Glow (2026 Trend: Tactile/Alive UI) */}
      <motion.div
        animate={{
          x: mousePosition.x - 400,
          y: mousePosition.y - 400,
        }}
        transition={{ type: 'tween', ease: 'backOut', duration: 0.5 }}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '800px',
          height: '800px',
          background: 'radial-gradient(circle, rgba(124, 58, 237, 0.15) 0%, transparent 60%)',
          borderRadius: '50%',
          pointerEvents: 'none',
          zIndex: 0,
          mixBlendMode: 'screen',
        }}
      />

      <motion.div
        animate={{
          x: mousePosition.x - 300,
          y: mousePosition.y - 300,
        }}
        transition={{ type: 'tween', ease: 'circOut', duration: 1.2 }}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '600px',
          height: '600px',
          background: 'radial-gradient(circle, rgba(6, 182, 212, 0.1) 0%, transparent 50%)',
          borderRadius: '50%',
          pointerEvents: 'none',
          zIndex: 0,
          mixBlendMode: 'screen',
        }}
      />

      {/* Hero Section */}
      <section
        style={{
          position: 'relative',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
          padding: '24px',
        }}
      >
        <motion.div style={{ y: yBg, opacity: opacityBg, textAlign: 'center', width: '100%' }}>
          
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', bounce: 0.5, duration: 1.2 }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '12px',
              padding: '8px 24px',
              borderRadius: '999px',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              backdropFilter: 'blur(12px)',
              marginBottom: '40px',
            }}
          >
            <span style={{ position: 'relative', display: 'flex', height: '10px', width: '10px' }}>
              <span style={{ animate: 'ping', position: 'absolute', display: 'inline-flex', height: '100%', width: '100%', borderRadius: '50%', backgroundColor: '#06B6D4', opacity: 0.75, animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}></span>
              <span style={{ position: 'relative', display: 'inline-flex', borderRadius: '50%', height: '10px', width: '10px', backgroundColor: '#06B6D4' }}></span>
            </span>
            <span style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#A1A1AA' }}>
              Next-Gen Audio Experience
            </span>
          </motion.div>

          <h1
            style={{
              fontSize: 'clamp(3rem, 10vw, 8rem)',
              fontWeight: 900,
              lineHeight: 0.9,
              letterSpacing: '-0.04em',
              margin: '0 0 32px 0',
              backgroundImage: 'linear-gradient(180deg, #FFFFFF 0%, rgba(255, 255, 255, 0.4) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: 'drop-shadow(0px 10px 30px rgba(0,0,0,0.5))',
            }}
          >
            <AnimatedText text="EchoFlip" />
            <span style={{ display: 'block', backgroundImage: 'linear-gradient(135deg, #7C3AED 0%, #06B6D4 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
               <AnimatedText text="AI Challenge" delay={2} />
            </span>
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.8, ease: 'easeOut' }}
            style={{
              fontSize: 'clamp(1.1rem, 2vw, 1.5rem)',
              color: '#A1A1AA',
              maxWidth: '600px',
              margin: '0 auto 48px auto',
              lineHeight: 1.6,
            }}
          >
            Твой голос. Обратная перемотка. Искусственный интеллект в роли беспристрастного судьи. Брось вызов реальности в главном лингвистическом тренде 2026 года.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, duration: 0.8, ease: 'easeOut' }}
            style={{ display: 'flex', gap: '20px', justifyContent: 'center', flexWrap: 'wrap' }}
          >
            <Link to={user ? '/lobby' : '/login'} style={{ textDecoration: 'none' }} aria-label={user ? 'Перейти в лобби' : 'Начать Эхо-Тест'}>
              <motion.div
                whileHover={{ scale: 1.05, boxShadow: '0 0 40px rgba(124, 58, 237, 0.4)' }}
                whileTap={{ scale: 0.95 }}
                style={{
                  padding: '18px 40px',
                  borderRadius: '100px',
                  background: 'linear-gradient(135deg, #7C3AED 0%, #06B6D4 100%)',
                  color: '#FFF',
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)', transform: 'translateX(-100%)', animation: 'shimmer 2.5s infinite' }} />
                <span>{user ? 'В Лобби' : 'Начать Эхо-Тест'}</span>
                <Play className="w-5 h-5" fill="currentColor" aria-hidden="true" />
              </motion.div>
            </Link>

            {!user && (
              <Link to="/login" style={{ textDecoration: 'none' }} aria-label="Войти в систему">
                <motion.div
                  whileHover={{ scale: 1.05, backgroundColor: 'rgba(255,255,255,0.1)' }}
                  whileTap={{ scale: 0.95 }}
                  style={{
                    padding: '18px 40px',
                    borderRadius: '100px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: '#FFF',
                    fontSize: '1.1rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    backdropFilter: 'blur(10px)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  Войти
                </motion.div>
              </Link>
            )}
          </motion.div>
        </motion.div>
      </section>

      {/* Features Grid - 2026 Bento Box Style */}
      <section
        style={{
          padding: '120px 24px',
          maxWidth: '1200px',
          margin: '0 auto',
          position: 'relative',
          zIndex: 10,
        }}
      >
        <motion.h2
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.8 }}
          style={{ textAlign: 'center', marginBottom: '80px', fontSize: 'clamp(2.5rem, 5vw, 4rem)', fontWeight: 800 }}
        >
          <AnimatedText
            text="Почему EchoFlip — это хит?"
            className="feature-title"
          />
        </motion.h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '32px',
          }}
        >
          {features.map((feature, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-50px' }}
              transition={{ delay: idx * 0.2, duration: 0.8, type: 'spring' }}
              whileHover={{ y: -10 }}
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid rgba(255, 255, 255, 0.05)',
                borderRadius: '32px',
                padding: '48px 32px',
                position: 'relative',
                overflow: 'hidden',
                backdropFilter: 'blur(20px)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  width: '150px',
                  height: '150px',
                  background: `radial-gradient(circle, ${feature.color}40 0%, transparent 70%)`,
                  filter: 'blur(30px)',
                  transform: 'translate(30%, -30%)',
                }}
              />
              <div style={{ marginBottom: '24px', color: feature.color }}>
                {feature.icon}
              </div>
              <h3 style={{ fontSize: '1.8rem', fontWeight: 700, marginBottom: '16px', color: '#FFF' }}>
                {feature.title}
              </h3>
              <p style={{ fontSize: '1.1rem', color: '#A1A1AA', lineHeight: 1.6, margin: 0 }}>
                {feature.desc}
              </p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Immersive CTA Section */}
      <section
        style={{
          padding: '120px 24px',
          background: 'linear-gradient(180deg, transparent 0%, rgba(124, 58, 237, 0.1) 100%)',
          position: 'relative',
          zIndex: 10,
          textAlign: 'center',
          overflow: 'hidden',
        }}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1, type: 'spring' }}
          style={{ maxWidth: '800px', margin: '0 auto' }}
        >
          <h2 style={{ fontSize: 'clamp(2.5rem, 6vw, 5rem)', fontWeight: 900, marginBottom: '32px', letterSpacing: '-0.03em' }}>
            Готов сломать свой мозг?
          </h2>
          <Link to={user ? '/lobby' : '/login'} style={{ textDecoration: 'none' }} aria-label="Сыграть прямо сейчас">
            <motion.div
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              style={{
                padding: '24px 56px',
                borderRadius: '100px',
                background: '#FFFFFF',
                color: '#05050A',
                fontSize: '1.5rem',
                fontWeight: 800,
                cursor: 'pointer',
                boxShadow: '0 20px 50px rgba(255,255,255,0.15)',
                display: 'inline-block',
              }}
            >
              Играть Сейчас
            </motion.div>
          </Link>
        </motion.div>
      </section>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes shimmer {
          100% {
            transform: translateX(100%);
          }
        }
        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: .5;
          }
        }
      `}} />
    </main>
    </>
  );
}
