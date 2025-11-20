import { motion } from 'framer-motion';

export function VoiceSilhouette() {
  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
      <motion.svg
        viewBox="0 0 200 300"
        className="w-full h-full"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1, ease: "easeOut" }}
      >
        <defs>
          <linearGradient id="silhouetteGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style={{ stopColor: '#0a1023', stopOpacity: 1 }} />
            <stop offset="40%" style={{ stopColor: '#1e3a8a', stopOpacity: 1 }} />
            <stop offset="70%" style={{ stopColor: '#2563eb', stopOpacity: 1 }} />
            <stop offset="100%" style={{ stopColor: '#3bb6ff', stopOpacity: 0.8 }} />
          </linearGradient>

          <filter id="silhouetteGlow">
            <feGaussianBlur stdDeviation="8" result="coloredBlur"/>
            <feColorMatrix
              in="coloredBlur"
              type="matrix"
              values="0 0 0 0 0.23
                      0 0 0 0 0.71
                      0 0 0 0 1
                      0 0 0 0.6 0"
            />
            <feMerge>
              <feMergeNode/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>

          <filter id="softBlur">
            <feGaussianBlur stdDeviation="2"/>
          </filter>
        </defs>

        <motion.path
          d="M 160 80
             Q 158 70, 155 60
             Q 150 45, 140 35
             Q 130 25, 115 20
             Q 100 15, 85 20
             Q 70 25, 60 35
             Q 52 45, 48 58
             L 48 75
             Q 47 85, 46 95
             L 45 110
             Q 44 120, 44 130
             L 44 150
             Q 44 165, 45 180
             Q 46 190, 48 200
             Q 50 210, 54 218
             Q 60 228, 70 235
             L 85 245
             Q 95 250, 105 252
             Q 115 254, 125 253
             Q 138 251, 148 245
             L 160 235
             Q 168 228, 172 218
             Q 175 210, 176 200
             L 177 185
             Q 177 175, 176 165
             L 175 145
             Q 174 130, 172 118
             L 168 100
             Q 165 90, 162 85
             Z"
          fill="url(#silhouetteGradient)"
          filter="url(#silhouetteGlow)"
          opacity="0.7"
        />

        <motion.path
          d="M 160 80
             Q 158 70, 155 60
             Q 150 45, 140 35
             Q 130 25, 115 20
             Q 100 15, 85 20
             Q 70 25, 60 35
             Q 52 45, 48 58
             L 48 75
             Q 47 85, 46 95
             L 45 110
             Q 44 120, 44 130
             L 44 150
             Q 44 165, 45 180
             Q 46 190, 48 200
             Q 50 210, 54 218
             Q 60 228, 70 235
             L 85 245
             Q 95 250, 105 252
             Q 115 254, 125 253
             Q 138 251, 148 245
             L 160 235
             Q 168 228, 172 218
             Q 175 210, 176 200
             L 177 185
             Q 177 175, 176 165
             L 175 145
             Q 174 130, 172 118
             L 168 100
             Q 165 90, 162 85
             Z"
          fill="url(#silhouetteGradient)"
          filter="url(#softBlur)"
          opacity="0.9"
          animate={{
            scale: [1, 1.01, 1],
            opacity: [0.9, 0.95, 0.9]
          }}
          transition={{
            duration: 4,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />

        <motion.ellipse
          cx="130"
          cy="90"
          rx="8"
          ry="10"
          fill="#1e3a8a"
          opacity="0.6"
          animate={{
            opacity: [0.6, 0.3, 0.6]
          }}
          transition={{
            duration: 3,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />

        <motion.path
          d="M 90 155 Q 100 160, 110 155"
          stroke="#2563eb"
          strokeWidth="2"
          fill="none"
          opacity="0.4"
          strokeLinecap="round"
        />
      </motion.svg>

      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-500/5 to-transparent pointer-events-none" />
    </div>
  );
}
