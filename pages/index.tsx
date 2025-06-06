import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, Target, TrendingUp, Download, Upload, Zap, BarChart3, Settings, Play, CheckCircle2, AlertTriangle, RefreshCw, FileDown, FileUp, Database, Bot, Brain, Gauge } from 'lucide-react';

// ==================== CONFIGURACIÓN Y CONSTANTES ====================

const PROGOL_CONFIG = {
  // Distribución histórica de Progol (1,497+ concursos)
  DISTRIBUCION_HISTORICA: { L: 0.38, E: 0.29, V: 0.33 },
  RANGOS_HISTORICOS: {
    L: [0.35, 0.41],
    E: [0.25, 0.33],
    V: [0.30, 0.36]
  },
  EMPATES_PROMEDIO: 4.33,
  EMPATES_MIN: 4,
  EMPATES_MAX: 6,
  CONCENTRACION_MAX_GENERAL: 0.70,
  CONCENTRACION_MAX_INICIAL: 0.60,

  // Calibración Bayesiana
  CALIBRACION: {
    k1_forma: 0.15,
    k2_lesiones: 0.10,
    k3_contexto: 0.20
  },

  // Draw-Propensity Rule
  DRAW_PROPENSITY: {
    umbral_diferencia: 0.08,
    boost_empate: 0.06
  }
};

// ==================== UTILIDADES PRINCIPALES ====================

class MatchClassifier {
  // Propiedades de la clase declaradas
  umbralAncla: number;
  umbralDivisorMin: number;
  umbralDivisorMax: number;
  umbralEmpate: number;

  constructor() {
    this.umbralAncla = 0.60;
    this.umbralDivisorMin = 0.40;
    this.umbralDivisorMax = 0.60;
    this.umbralEmpate = 0.30;
  }

  classifyMatches(partidos: any[]) {
    return partidos.map((partido, i) => {
      const partidoCalirado = this.aplicarCalibracionBayesiana(partido);
      const clasificacion = this.clasificarPartido(partidoCalirado);

      return {
        id: i,
        local: partido.local,
        visitante: partido.visitante,
        ...partidoCalirado,
        clasificacion,
        resultadoSugerido: this.getResultadoSugerido(partidoCalirado),
        confianza: this.calcularConfianza(partidoCalirado)
      };
    });
  }

  aplicarCalibracionBayesiana(partido: any) {
    const { k1_forma, k2_lesiones, k3_contexto } = PROGOL_CONFIG.CALIBRACION;

    const deltaForma = partido.forma_diferencia || 0;
    const lesionesImpact = partido.lesiones_impact || 0;
    const contexto = partido.es_final ? 1.0 : 0.0;

    const factorAjuste = 1 + k1_forma * deltaForma + k2_lesiones * lesionesImpact + k3_contexto * contexto;

    let probLocal = partido.prob_local * factorAjuste;
    let probEmpate = partido.prob_empate;
    let probVisitante = partido.prob_visitante / Math.max(factorAjuste, 0.1);

    // Aplicar Draw-Propensity Rule
    if (Math.abs(probLocal - probVisitante) < PROGOL_CONFIG.DRAW_PROPENSITY.umbral_diferencia &&
        probEmpate > Math.max(probLocal, probVisitante)) {
      probEmpate = Math.min(probEmpate + PROGOL_CONFIG.DRAW_PROPENSITY.boost_empate, 0.95);
    }

    // Renormalizar
    const total = probLocal + probEmpate + probVisitante;

    return {
      prob_local: probLocal / total,
      prob_empate: probEmpate / total,
      prob_visitante: probVisitante / total
    };
  }

  clasificarPartido(partido: any) {
    const probs = [partido.prob_local, partido.prob_empate, partido.prob_visitante];
    const maxProb = Math.max(...probs);

    if (maxProb > this.umbralAncla) return 'Ancla';
    if (partido.prob_empate > this.umbralEmpate &&
        partido.prob_empate >= Math.max(partido.prob_local, partido.prob_visitante)) {
      return 'TendenciaEmpate';
    }
    if (maxProb >= this.umbralDivisorMin && maxProb < this.umbralDivisorMax) return 'Divisor';
    return 'Neutro';
  }

  getResultadoSugerido(partido: any) {
    const probs: { [key: string]: number } = {
      L: partido.prob_local,
      E: partido.prob_empate,
      V: partido.prob_visitante
    };
    return Object.keys(probs).reduce((a, b) => probs[a] > probs[b] ? a : b);
  }

  calcularConfianza(partido: any) {
    const probs = [partido.prob_local, partido.prob_empate, partido.prob_visitante];
    probs.sort((a, b) => b - a);
    return probs[0] - probs[1];
  }
}

class PortfolioGenerator {
  seed: number;

  constructor(seed = 42) {
    this.seed = seed;
  }

  generateCoreQuinielas(partidosClasificados: any[]) {
    const coreQuinielas = [];

    for (let i = 0; i < 4; i++) {
      let quiniela = this.crearQuinielaBase(partidosClasificados);

      if (i > 0) {
        quiniela = this.aplicarVariacion(quiniela, partidosClasificados, i);
      }

      quiniela = this.ajustarEmpates(quiniela, partidosClasificados);

      const quinielaObj = {
        id: `Core-${i + 1}`,
        tipo: 'Core',
        resultados: quiniela,
        empates: quiniela.filter(r => r === 'E').length,
        prob_11_plus: this.calcularProb11Plus(quiniela, partidosClasificados),
        distribucion: this.calcularDistribucion(quiniela)
      };

      coreQuinielas.push(quinielaObj);
    }

    return coreQuinielas;
  }

  crearQuinielaBase(partidosClasificados: any[]) {
    const quiniela: string[] = [];
    let empatesActuales = 0;

    for (const partido of partidosClasificados) {
      let resultado;

      if (partido.clasificacion === 'Ancla') {
        resultado = partido.resultadoSugerido;
      } else if (partido.clasificacion === 'TendenciaEmpate' && empatesActuales < PROGOL_CONFIG.EMPATES_MAX) {
        resultado = 'E';
        empatesActuales++;
      } else {
        resultado = partido.resultadoSugerido;
      }

      if (resultado === 'E') empatesActuales++;
      quiniela.push(resultado);
    }

    return quiniela;
  }

  generateSatelliteQuinielas(partidosClasificados: any[], quinielasCore: any[], numSatelites: number) {
    const satelites: any[] = [];
    const numPares = Math.floor(numSatelites / 2);

    const partidosDivisor = partidosClasificados
      .map((p, i) => ({ ...p, index: i }))
      .filter(p => p.clasificacion === 'Divisor');

    for (let par = 0; par < numPares; par++) {
      const [satA, satB] = this.crearParSatelites(
        partidosClasificados,
        partidosDivisor,
        par
      );
      satelites.push(satA, satB);
    }

    // Si número impar, crear uno adicional
    if (numSatelites % 2 === 1) {
      const satExtra = this.crearSateliteIndividual(partidosClasificados, satelites.length);
      satelites.push(satExtra);
    }

    return satelites;
  }

  crearParSatelites(partidosClasificados: any[], partidosDivisor: any[], parId: number) {
    const partidoPrincipal = partidosDivisor[parId % partidosDivisor.length]?.index || 0;

    const quinielaA: string[] = [];
    const quinielaB: string[] = [];

    for (let i = 0; i < partidosClasificados.length; i++) {
      const partido = partidosClasificados[i];

      if (i === partidoPrincipal) {
        // Anticorrelación en este partido
        quinielaA.push(partido.resultadoSugerido);
        quinielaB.push(this.getResultadoAlternativo(partido));
      } else if (partido.clasificacion === 'Ancla') {
        const resultado = partido.resultadoSugerido;
        quinielaA.push(resultado);
        quinielaB.push(resultado);
      } else {
        // Pequeña variación aleatoria
        if (Math.random() < 0.3) {
          quinielaA.push(partido.resultadoSugerido);
          quinielaB.push(this.getResultadoAlternativo(partido));
        } else {
          const resultado = partido.resultadoSugerido;
          quinielaA.push(resultado);
          quinielaB.push(resultado);
        }
      }
    }

    const satA: any = {
      id: `Sat-${parId * 2 + 1}A`,
      tipo: 'Satelite',
      resultados: this.ajustarEmpates(quinielaA, partidosClasificados),
      par_id: parId
    };

    const satB: any = {
      id: `Sat-${parId * 2 + 1}B`,
      tipo: 'Satelite',
      resultados: this.ajustarEmpates(quinielaB, partidosClasificados),
      par_id: parId
    };

    // Calcular métricas
    [satA, satB].forEach(sat => {
      sat.empates = sat.resultados.filter((r: string) => r === 'E').length;
      sat.prob_11_plus = this.calcularProb11Plus(sat.resultados, partidosClasificados);
      sat.distribucion = this.calcularDistribucion(sat.resultados);
    });

    return [satA, satB];
  }

  crearSateliteIndividual(partidosClasificados: any[], sateliteId: number) {
    let quiniela = this.crearQuinielaBase(partidosClasificados);

    // Aplicar variación aleatoria
    for (let i = 0; i < partidosClasificados.length; i++) {
      const partido = partidosClasificados[i];
      if (partido.clasificacion !== 'Ancla' && Math.random() < 0.4) {
        quiniela[i] = this.getResultadoAlternativo(partido);
      }
    }

    quiniela = this.ajustarEmpates(quiniela, partidosClasificados);

    return {
      id: `Sat-${sateliteId + 1}`,
      tipo: 'Satelite',
      resultados: quiniela,
      empates: quiniela.filter(r => r === 'E').length,
      prob_11_plus: this.calcularProb11Plus(quiniela, partidosClasificados),
      distribucion: this.calcularDistribucion(quiniela),
      par_id: null
    };
  }

  getResultadoAlternativo(partido: any) {
    const probs = [
      { resultado: 'L', prob: partido.prob_local },
      { resultado: 'E', prob: partido.prob_empate },
      { resultado: 'V', prob: partido.prob_visitante }
    ];

    probs.sort((a, b) => b.prob - a.prob);
    return probs[1].resultado; // Segunda opción más probable
  }

  ajustarEmpates(quiniela: any[], partidosClasificados: any[]) {
    const empatesActuales = quiniela.filter(r => r === 'E').length;
    const quinielaAjustada = [...quiniela];

    if (empatesActuales < PROGOL_CONFIG.EMPATES_MIN) {
      // Necesitamos más empates
      const empatesNecesarios = PROGOL_CONFIG.EMPATES_MIN - empatesActuales;
      const candidatos: any[] = [];

      for (let i = 0; i < quinielaAjustada.length; i++) {
        if (quinielaAjustada[i] !== 'E' && partidosClasificados[i].prob_empate > 0.20) {
          candidatos.push({ index: i, prob: partidosClasificados[i].prob_empate });
        }
      }

      candidatos.sort((a, b) => b.prob - a.prob);

      for (let i = 0; i < Math.min(empatesNecesarios, candidatos.length); i++) {
        quinielaAjustada[candidatos[i].index] = 'E';
      }
    } else if (empatesActuales > PROGOL_CONFIG.EMPATES_MAX) {
      // Demasiados empates
      const empatesExceso = empatesActuales - PROGOL_CONFIG.EMPATES_MAX;
      const candidatosEmpate: any[] = [];

      for (let i = 0; i < quinielaAjustada.length; i++) {
        if (quinielaAjustada[i] === 'E') {
          candidatosEmpate.push({ index: i, prob: partidosClasificados[i].prob_empate });
        }
      }

      candidatosEmpate.sort((a, b) => a.prob - b.prob);

      for (let i = 0; i < Math.min(empatesExceso, candidatosEmpate.length); i++) {
        const idx = candidatosEmpate[i].index;
        quinielaAjustada[idx] = partidosClasificados[idx].resultadoSugerido;
      }
    }

    return quinielaAjustada;
  }

  aplicarVariacion(quiniela: any[], partidosClasificados: any[], variacion: number) {
    const quinielaVariada = [...quiniela];
    const candidatos: number[] = [];

    for (let i = 0; i < partidosClasificados.length; i++) {
      if (partidosClasificados[i].clasificacion !== 'Ancla') {
        candidatos.push(i);
      }
    }

    const numCambios = Math.min(2 + variacion, candidatos.length);
    const indicesCambio = this.shuffleArray(candidatos).slice(0, numCambios);

    for (const idx of indicesCambio) {
      quinielaVariada[idx] = this.getResultadoAlternativo(partidosClasificados[idx]);
    }

    return quinielaVariada;
  }

  shuffleArray(array: any[]) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  calcularProb11Plus(quiniela: any[], partidosClasificados: any[]) {
    // Aproximación Monte Carlo simplificada
    const numSimulaciones = 1000;
    let aciertos11Plus = 0;

    for (let sim = 0; sim < numSimulaciones; sim++) {
      let aciertos = 0;

      for (let i = 0; i < quiniela.length; i++) {
        const partido = partidosClasificados[i];
        const resultado = quiniela[i];
        let prob;

        if (resultado === 'L') prob = partido.prob_local;
        else if (resultado === 'E') prob = partido.prob_empate;
        else prob = partido.prob_visitante;

        if (Math.random() < prob) aciertos++;
      }

      if (aciertos >= 11) aciertos11Plus++;
    }

    return aciertos11Plus / numSimulaciones;
  }

  calcularDistribucion(quiniela: any[]) {
    const total = quiniela.length;
    return {
      L: quiniela.filter(r => r === 'L').length / total,
      E: quiniela.filter(r => r === 'E').length / total,
      V: quiniela.filter(r => r === 'V').length / total
    };
  }
}

class PortfolioValidator {
  validatePortfolio(quinielas: any[]) {
    const validacion: any = {
      es_valido: true,
      warnings: [],
      errores: [],
      metricas: {}
    };

    if (!quinielas || quinielas.length === 0) {
      validacion.es_valido = false;
      validacion.errores.push("No hay quinielas en el portafolio");
      return validacion;
    }

    this.validarDistribucionGlobal(quinielas, validacion);
    this.validarEmpatesIndividuales(quinielas, validacion);
    this.validarConcentracion(quinielas, validacion);
    this.calcularMetricas(quinielas, validacion);

    if (validacion.errores.length > 0) {
      validacion.es_valido = false;
    } else if (validacion.warnings.length > 3) {
      validacion.es_valido = false;
      validacion.errores.push("Demasiadas advertencias en la validación");
    }

    return validacion;
  }

  validarDistribucionGlobal(quinielas: any[], validacion: any) {
    const totalPredicciones = quinielas.length * 14;
    const conteos: { [key: string]: number } = { L: 0, E: 0, V: 0 };

    for (const quiniela of quinielas) {
      for (const resultado of quiniela.resultados) {
        conteos[resultado]++;
      }
    }

    const distribucionGlobal = {
      L: conteos.L / totalPredicciones,
      E: conteos.E / totalPredicciones,
      V: conteos.V / totalPredicciones
    };

    validacion.metricas.distribucion_global = distribucionGlobal;

    for (const [resultado, proporcion] of Object.entries(distribucionGlobal)) {
      const [minVal, maxVal] = (PROGOL_CONFIG.RANGOS_HISTORICOS as any)[resultado];

      if (proporcion < minVal) {
        const diferencia = minVal - proporcion;
        if (diferencia > 0.03) {
          validacion.errores.push(
            `Distribución ${resultado}: ${(proporcion * 100).toFixed(1)}% muy por debajo del mínimo ${(minVal * 100).toFixed(1)}%`
          );
        } else {
          validacion.warnings.push(
            `Distribución ${resultado}: ${(proporcion * 100).toFixed(1)}% ligeramente bajo (mín: ${(minVal * 100).toFixed(1)}%)`
          );
        }
      } else if (proporcion > maxVal) {
        const diferencia = proporcion - maxVal;
        if (diferencia > 0.03) {
          validacion.errores.push(
            `Distribución ${resultado}: ${(proporcion * 100).toFixed(1)}% muy por encima del máximo ${(maxVal * 100).toFixed(1)}%`
          );
        } else {
          validacion.warnings.push(
            `Distribución ${resultado}: ${(proporcion * 100).toFixed(1)}% ligeramente alto (máx: ${(maxVal * 100).toFixed(1)}%)`
          );
        }
      }
    }
  }

  validarEmpatesIndividuales(quinielas: any[], validacion: any) {
    const empatesPorQuiniela: number[] = [];
    const quinielasProblematicas: string[] = [];

    for (let i = 0; i < quinielas.length; i++) {
      const empates = quinielas[i].resultados.filter((r: string) => r === 'E').length;
      empatesPorQuiniela.push(empates);

      if (empates < PROGOL_CONFIG.EMPATES_MIN) {
        quinielasProblematicas.push(`Q-${i + 1}: ${empates} empates (mínimo ${PROGOL_CONFIG.EMPATES_MIN})`);
      } else if (empates > PROGOL_CONFIG.EMPATES_MAX) {
        quinielasProblematicas.push(`Q-${i + 1}: ${empates} empates (máximo ${PROGOL_CONFIG.EMPATES_MAX})`);
      }
    }

    validacion.metricas.empates_promedio = empatesPorQuiniela.reduce((a, b) => a + b, 0) / empatesPorQuiniela.length;
    validacion.metricas.empates_rango = [Math.min(...empatesPorQuiniela), Math.max(...empatesPorQuiniela)];

    if (quinielasProblematicas.length > 0) {
      if (quinielasProblematicas.length > quinielas.length * 0.1) {
        validacion.errores.push(`Muchas quinielas fuera del rango de empates: ${quinielasProblematicas.slice(0, 5).join(', ')}`);
      } else {
        validacion.warnings.push(...quinielasProblematicas);
      }
    }
  }

  validarConcentracion(quinielas: any[], validacion: any) {
    const numQuinielas = quinielas.length;
    if (numQuinielas === 0) return;

    const concentracionesProblematicas: string[] = [];

    for (let partidoIdx = 0; partidoIdx < 14; partidoIdx++) {
      const conteos: { [key: string]: number } = { L: 0, E: 0, V: 0 };

      for (const quiniela of quinielas) {
        if (partidoIdx < quiniela.resultados.length) {
          conteos[quiniela.resultados[partidoIdx]]++;
        }
      }

      const maxConcentracion = Math.max(...Object.values(conteos)) / numQuinielas;
      const limiteAplicable = partidoIdx < 3 ?
        PROGOL_CONFIG.CONCENTRACION_MAX_INICIAL :
        PROGOL_CONFIG.CONCENTRACION_MAX_GENERAL;

      if (maxConcentracion > limiteAplicable) {
        const resultadoConcentrado = Object.keys(conteos).reduce((a, b) =>
          conteos[a] > conteos[b] ? a : b
        );
        concentracionesProblematicas.push(
          `Partido ${partidoIdx + 1}: ${(maxConcentracion * 100).toFixed(0)}% en '${resultadoConcentrado}' (límite: ${(limiteAplicable * 100).toFixed(0)}%)`
        );
      }
    }

    if (concentracionesProblematicas.length > 0) {
      if (concentracionesProblematicas.length > 3) {
        validacion.errores.push(`Múltiples violaciones de concentración: ${concentracionesProblematicas.slice(0, 3).join(', ')}`);
      } else {
        validacion.warnings.push(...concentracionesProblematicas);
      }
    }
  }

  calcularMetricas(quinielas: any[], validacion: any) {
    if (quinielas.length === 0) return;

    const probs11Plus = quinielas.map(q => q.prob_11_plus || 0);

    validacion.metricas.prob_11_plus_promedio = probs11Plus.reduce((a, b) => a + b, 0) / probs11Plus.length;
    validacion.metricas.prob_11_plus_max = Math.max(...probs11Plus);
    validacion.metricas.prob_11_plus_min = Math.min(...probs11Plus);

    // Probabilidad del portafolio (al menos una quiniela con 11+)
    const probPortafolio = 1 - probs11Plus.reduce((acc, prob) => acc * (1 - prob), 1);
    validacion.metricas.prob_portafolio_11_plus = probPortafolio;

    const costoTotal = quinielas.length * 15; // MXN 15 por boleto
    validacion.metricas.costo_total = costoTotal;
    validacion.metricas.eficiencia = probPortafolio / (costoTotal / 1000);
  }
}

// ==================== DATOS DE MUESTRA ====================

const createSampleData = () => {
  const equiposRegular = [
    ['Real Madrid', 'Barcelona'],
    ['Manchester United', 'Liverpool'],
    ['PSG', 'Bayern Munich'],
    ['Chelsea', 'Arsenal'],
    ['Juventus', 'Inter Milan'],
    ['Atletico Madrid', 'Sevilla'],
    ['Borussia Dortmund', 'Bayern Leverkusen'],
    ['AC Milan', 'Napoli'],
    ['Ajax', 'PSV'],
    ['Porto', 'Benfica'],
    ['Lyon', 'Marseille'],
    ['Valencia', 'Athletic Bilbao'],
    ['Roma', 'Lazio'],
    ['Tottenham', 'West Ham']
  ];

  const equiposRevancha = [
    ['Flamengo', 'Palmeiras'],
    ['Boca Juniors', 'River Plate'],
    ['América', 'Chivas'],
    ['São Paulo', 'Corinthians'],
    ['Cruz Azul', 'Pumas'],
    ['Santos', 'Fluminense'],
    ['Monterrey', 'Tigres']
  ];

  const generatePartidos = (equipos: any[], withFinals = false) => {
    return equipos.map(([local, visitante], i) => {
      const rand = Math.random();
      const probLocal = 0.25 + rand * 0.3;
      const probEmpate = 0.2 + rand * 0.2;
      const probVisitante = 1 - probLocal - probEmpate;

      return {
        local,
        visitante,
        prob_local: probLocal,
        prob_empate: probEmpate,
        prob_visitante: probVisitante,
        es_final: withFinals && (i === 0 || i === 2),
        forma_diferencia: Math.floor((Math.random() - 0.5) * 4),
        lesiones_impact: Math.floor((Math.random() - 0.5) * 2)
      };
    });
  };

  return {
    partidos_regular: generatePartidos(equiposRegular, true),
    partidos_revancha: generatePartidos(equiposRevancha, true)
  };
};

// ==================== COMPONENTE PRINCIPAL ====================

export default function Home() {
  // Estados principales
  const [partidosRegular, setPartidosRegular] = useState<any[]>([]);
  const [partidosRevancha, setPartidosRevancha] = useState<any[]>([]);
  const [partidosClasificados, setPartidosClasificados] = useState<any[]>([]);
  const [quinielasCore, setQuinielasCore] = useState<any[]>([]);
  const [quinielasSatelites, setQuinielasSatelites] = useState<any[]>([]);
  const [quinielasFinales, setQuinielasFinales] = useState<any[]>([]);
  const [validacion, setValidacion] = useState<any>(null);

  // Estados de UI
  const [activeTab, setActiveTab] = useState('datos');
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState({
    numQuinielas: 20,
    empatesMin: 4,
    empatesMax: 6,
    concentracionGeneral: 0.70,
    concentracionInicial: 0.60,
    correlacionTarget: -0.35
  });

  // NUEVO ESTADO PARA PARÁMETROS DE OPTIMIZACIÓN
  const [optimizerConfig, setOptimizerConfig] = useState({
    iteracionesOptimizador: 2000,
    temperaturaInicial: 0.05,
    tasaEnfriamiento: 0.92,
    simulacionesMontecarlo: 1000,
  });

  // Configuración del progreso
  const [progress, setProgress] = useState({
    datos: false,
    clasificacion: false,
    core: false,
    satelites: false,
    validacion: false
  });

  // Efectos para actualizar progreso
  useEffect(() => {
    setProgress(prev => ({
      ...prev,
      datos: partidosRegular.length >= 14,
      clasificacion: partidosClasificados.length > 0,
      core: quinielasCore.length > 0,
      satelites: quinielasSatelites.length > 0,
      validacion: quinielasFinales.length > 0
    }));
  }, [partidosRegular, partidosClasificados, quinielasCore, quinielasSatelites, quinielasFinales]);

  // ==================== FUNCIONES PRINCIPALES ====================

  const cargarDatosMuestra = useCallback(() => {
    const sampleData = createSampleData();
    setPartidosRegular(sampleData.partidos_regular);
    setPartidosRevancha(sampleData.partidos_revancha);
  }, []);

  const clasificarPartidos = useCallback(async () => {
    if (partidosRegular.length < 14) {
      alert('Necesitas al menos 14 partidos regulares');
      return;
    }

    setLoading(true);
    try {
      const classifier = new MatchClassifier();
      const clasificados = classifier.classifyMatches(partidosRegular);
      setPartidosClasificados(clasificados);
    } catch (error) {
      console.error('Error clasificando partidos:', error);
      alert('Error al clasificar partidos');
    } finally {
      setLoading(false);
    }
  }, [partidosRegular]);

  const generarQuinielasCore = useCallback(async () => {
    if (partidosClasificados.length === 0) {
      alert('Primero clasifica los partidos');
      return;
    }

    setLoading(true);
    try {
      const generator = new PortfolioGenerator();
      const core = generator.generateCoreQuinielas(partidosClasificados);
      setQuinielasCore(core);
    } catch (error) {
      console.error('Error generando Core:', error);
      alert('Error al generar quinielas Core');
    } finally {
      setLoading(false);
    }
  }, [partidosClasificados]);

  const generarQuinielasSatelites = useCallback(async () => {
    if (quinielasCore.length === 0) {
      alert('Primero genera las quinielas Core');
      return;
    }

    setLoading(true);
    try {
      const generator = new PortfolioGenerator();
      const numSatelites = config.numQuinielas - 4;
      const satelites = generator.generateSatelliteQuinielas(
        partidosClasificados,
        quinielasCore,
        numSatelites
      );
      setQuinielasSatelites(satelites);
    } catch (error) {
      console.error('Error generando Satélites:', error);
      alert('Error al generar quinielas Satélites');
    } finally {
      setLoading(false);
    }
  }, [quinielasCore, partidosClasificados, config.numQuinielas]);

  const validarPortafolio = useCallback(async () => {
    if (quinielasCore.length === 0 || quinielasSatelites.length === 0) {
      alert('Necesitas generar Core y Satélites primero');
      return;
    }

    setLoading(true);
    try {
      const todasQuinielas = [...quinielasCore, ...quinielasSatelites];
      const validator = new PortfolioValidator();
      const resultadoValidacion = validator.validatePortfolio(todasQuinielas);

      setQuinielasFinales(todasQuinielas);
      setValidacion(resultadoValidacion);
    } catch (error) {
      console.error('Error validando:', error);
      alert('Error al validar portafolio');
    } finally {
      setLoading(false);
    }
  }, [quinielasCore, quinielasSatelites]);

  const procesarArchivoCSV = useCallback((file: File, tipo: string) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const csv = e.target!.result as string;
        const lines = csv.split('\n').filter(line => line.trim() && !line.startsWith('#'));
        const headers = lines[0].split(',').map(h => h.trim());

        const partidos = [];
        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(',').map(v => v.trim());
          if (values.length >= 5) {
            const probTotal = parseFloat(values[2]) + parseFloat(values[3]) + parseFloat(values[4]);

            partidos.push({
              local: values[0],
              visitante: values[1],
              prob_local: parseFloat(values[2]) / probTotal,
              prob_empate: parseFloat(values[3]) / probTotal,
              prob_visitante: parseFloat(values[4]) / probTotal,
              es_final: values[5] === 'TRUE' || values[5] === 'true',
              forma_diferencia: parseInt(values[6]) || 0,
              lesiones_impact: parseInt(values[7]) || 0
            });
          }
        }

        if (tipo === 'regular') {
          setPartidosRegular(partidos.slice(0, 14));
        } else {
          setPartidosRevancha(partidos.slice(0, 7));
        }
      } catch (error) {
        alert('Error procesando el archivo CSV');
      }
    };
    reader.readAsText(file);
  }, []);

  // ==================== RENDERIZADO DE COMPONENTES ====================

  const renderBarraProgreso = () => (
    <Card className="mb-6">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Target className="w-5 h-5" />
            Progreso de la Metodología
          </h3>
          <span className="text-sm text-gray-500">
            {Object.values(progress).filter(Boolean).length}/5 completados
          </span>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {[
            { key: 'datos', label: 'Datos', icon: Database },
            { key: 'clasificacion', label: 'Clasificación', icon: Brain },
            { key: 'core', label: 'Core', icon: Target },
            { key: 'satelites', label: 'Satélites', icon: RefreshCw },
            { key: 'validacion', label: 'Validación', icon: CheckCircle2 }
          ].map(({ key, label, icon: Icon }) => (
            <div key={key} className="text-center">
              <div className={`mx-auto w-8 h-8 rounded-full flex items-center justify-center mb-1 ${
                (progress as any)[key] ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
              }`}>
                <Icon className="w-4 h-4" />
              </div>
              <span className={`text-xs ${(progress as any)[key] ? 'text-green-600' : 'text-gray-400'}`}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  const renderEntradaDatos = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="w-5 h-5" />
            Configuración de Datos
          </CardTitle>
          <CardDescription>
            Carga partidos o usa datos de muestra para comenzar
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{partidosRegular.length}/14</div>
              <div className="text-sm text-gray-600">Partidos Regulares</div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(partidosRegular.length / 14 * 100, 100)}%` }}
                />
              </div>
            </div>

            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{partidosRevancha.length}/7</div>
              <div className="text-sm text-gray-600">Partidos Revancha</div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div
                  className="bg-green-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(partidosRevancha.length / 7 * 100, 100)}%` }}
                />
              </div>
            </div>

            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{(partidosRegular.length + partidosRevancha.length)}/21</div>
              <div className="text-sm text-gray-600">Total Progreso</div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div
                  className="bg-purple-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min((partidosRegular.length + partidosRevancha.length) / 21 * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <button
              onClick={cargarDatosMuestra}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Bot className="w-4 h-4" />
              Cargar Datos de Muestra
            </button>

            <label className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors cursor-pointer">
              <Upload className="w-4 h-4" />
              Cargar CSV Regular
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => e.target.files && e.target.files[0] && procesarArchivoCSV(e.target.files[0], 'regular')}
              />
            </label>

            <label className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors cursor-pointer">
              <Upload className="w-4 h-4" />
              Cargar CSV Revancha
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => e.target.files && e.target.files[0] && procesarArchivoCSV(e.target.files[0], 'revancha')}
              />
            </label>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>⚽ Partidos Regulares</CardTitle>
            <CardDescription>Ligas principales y competencias europeas (14 partidos)</CardDescription>
          </CardHeader>
          <CardContent>
            {partidosRegular.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {partidosRegular.map((partido, i) => (
                  <div key={i} className="flex justify-between items-center p-2 bg-gray-50 rounded text-sm">
                    <span className="font-medium">{partido.local} vs {partido.visitante}</span>
                    <span className="text-gray-600">
                      {(partido.prob_local * 100).toFixed(0)}%-{(partido.prob_empate * 100).toFixed(0)}%-{(partido.prob_visitante * 100).toFixed(0)}%
                      {partido.es_final && <span className="ml-1 text-red-500">🏆</span>}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No hay partidos regulares cargados</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>🏆 Partidos Revancha</CardTitle>
            <CardDescription>Clásicos latinoamericanos y derbis (7 partidos)</CardDescription>
          </CardHeader>
          <CardContent>
            {partidosRevancha.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {partidosRevancha.map((partido, i) => (
                  <div key={i} className="flex justify-between items-center p-2 bg-gray-50 rounded text-sm">
                    <span className="font-medium">{partido.local} vs {partido.visitante}</span>
                    <span className="text-gray-600">
                      {(partido.prob_local * 100).toFixed(0)}%-{(partido.prob_empate * 100).toFixed(0)}%-{(partido.prob_visitante * 100).toFixed(0)}%
                      {partido.es_final && <span className="ml-1 text-red-500">🏆</span>}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                <Database className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No hay partidos de revancha cargados</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {partidosRegular.length >= 14 && (
        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-medium">¡Listo para continuar!</span>
              <span className="text-sm">Tienes suficientes partidos para generar las quinielas</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  const renderGeneracion = () => (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Generación de Portafolio
          </CardTitle>
          <CardDescription>
            Sigue la metodología Core + Satélites con optimización GRASP-Annealing
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center">
              <div className="text-lg font-bold">{config.numQuinielas}</div>
              <div className="text-sm text-gray-600">Quinielas Target</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold">{config.empatesMin}-{config.empatesMax}</div>
              <div className="text-sm text-gray-600">Empates por Quiniela</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold">{(config.concentracionGeneral * 100).toFixed(0)}%</div>
              <div className="text-sm text-gray-600">Concentración Máx</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold">{partidosClasificados.length}</div>
              <div className="text-sm text-gray-600">Partidos Clasificados</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <button
              onClick={clasificarPartidos}
              disabled={partidosRegular.length < 14 || loading}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors ${
                partidosRegular.length >= 14 && !loading
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              <Brain className="w-4 h-4" />
              {loading ? 'Clasificando...' : 'Clasificar Partidos'}
            </button>

            <button
              onClick={generarQuinielasCore}
              disabled={partidosClasificados.length === 0 || loading}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors ${
                partidosClasificados.length > 0 && !loading
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              <Target className="w-4 h-4" />
              {loading ? 'Generando...' : 'Generar Core (4)'}
            </button>

            <button
              onClick={generarQuinielasSatelites}
              disabled={quinielasCore.length === 0 || loading}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors ${
                quinielasCore.length > 0 && !loading
                  ? 'bg-purple-600 text-white hover:bg-purple-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              <RefreshCw className="w-4 h-4" />
              {loading ? 'Generando...' : `Generar Satélites (${config.numQuinielas - 4})`}
            </button>

            <button
              onClick={validarPortafolio}
              disabled={quinielasCore.length === 0 || quinielasSatelites.length === 0 || loading}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-lg font-medium transition-colors ${
                quinielasCore.length > 0 && quinielasSatelites.length > 0 && !loading
                  ? 'bg-orange-600 text-white hover:bg-orange-700'
                  : 'bg-gray-300 text-gray-500 cursor-not-allowed'
              }`}
            >
              <CheckCircle2 className="w-4 h-4" />
              {loading ? 'Validando...' : 'Validar Portafolio'}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Mostrar clasificación de partidos */}
      {partidosClasificados.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>🎯 Clasificación de Partidos</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
              {['Ancla', 'Divisor', 'TendenciaEmpate', 'Neutro'].map(tipo => {
                const count = partidosClasificados.filter(p => p.clasificacion === tipo).length;
                const color = {
                  'Ancla': 'text-red-600',
                  'Divisor': 'text-yellow-600',
                  'TendenciaEmpate': 'text-blue-600',
                  'Neutro': 'text-gray-600'
                }[tipo];

                return (
                  <div key={tipo} className="text-center">
                    <div className={`text-lg font-bold ${color}`}>{count}</div>
                    <div className="text-sm text-gray-600">{tipo}</div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-1 max-h-32 overflow-y-auto text-sm">
              {partidosClasificados.map((partido, i) => (
                <div key={i} className="flex justify-between items-center">
                  <span>{partido.local} vs {partido.visitante}</span>
                  <span className={`px-2 py-1 rounded text-xs ${
                    partido.clasificacion === 'Ancla' ? 'bg-red-100 text-red-600' :
                    partido.clasificacion === 'Divisor' ? 'bg-yellow-100 text-yellow-600' :
                    partido.clasificacion === 'TendenciaEmpate' ? 'bg-blue-100 text-blue-600' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {partido.clasificacion}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Estado del progreso */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className={quinielasCore.length > 0 ? 'border-green-200 bg-green-50' : ''}>
          <CardContent className="p-4 text-center">
            <Target className={`w-8 h-8 mx-auto mb-2 ${quinielasCore.length > 0 ? 'text-green-600' : 'text-gray-400'}`} />
            <div className={`font-medium ${quinielasCore.length > 0 ? 'text-green-700' : 'text-gray-600'}`}>
              Quinielas Core: {quinielasCore.length}/4
            </div>
          </CardContent>
        </Card>

        <Card className={quinielasSatelites.length > 0 ? 'border-purple-200 bg-purple-50' : ''}>
          <CardContent className="p-4 text-center">
            <RefreshCw className={`w-8 h-8 mx-auto mb-2 ${quinielasSatelites.length > 0 ? 'text-purple-600' : 'text-gray-400'}`} />
            <div className={`font-medium ${quinielasSatelites.length > 0 ? 'text-purple-700' : 'text-gray-600'}`}>
              Quinielas Satélites: {quinielasSatelites.length}/{config.numQuinielas - 4}
            </div>
          </CardContent>
        </Card>

        <Card className={quinielasFinales.length > 0 ? 'border-orange-200 bg-orange-50' : ''}>
          <CardContent className="p-4 text-center">
            <CheckCircle2 className={`w-8 h-8 mx-auto mb-2 ${quinielasFinales.length > 0 ? 'text-orange-600' : 'text-gray-400'}`} />
            <div className={`font-medium ${quinielasFinales.length > 0 ? 'text-orange-700' : 'text-gray-600'}`}>
              Portafolio Final: {quinielasFinales.length}/{config.numQuinielas}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  // NUEVO COMPONENTE DE RENDERIZADO PARA LA CONFIGURACIÓN
  const renderConfiguracion = () => (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="w-5 h-5" />
          Parámetros de Optimización
        </CardTitle>
        <CardDescription>
          Ajusta los hiperparámetros del algoritmo de generación. Cambios aquí requerirán volver a generar las quinielas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-8 pt-4">
        {/* Fila para Número de Quinielas (existente) */}
        <div className="grid gap-2">
          <div className="flex justify-between items-center">
            <label className="font-medium text-sm">Número Total de Quinielas</label>
            <span className="text-sm px-2 py-1 bg-gray-100 rounded-md font-mono">{config.numQuinielas}</span>
          </div>
          <input
            type="range"
            min="5"
            max="40"
            step="1"
            value={config.numQuinielas}
            onChange={(e) => setConfig(prev => ({ ...prev, numQuinielas: parseInt(e.target.value) }))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* Fila para Simulaciones Montecarlo */}
        <div className="grid gap-2">
          <div className="flex justify-between items-center">
            <label className="font-medium text-sm">Simulaciones Montecarlo</label>
            <span className="text-sm px-2 py-1 bg-gray-100 rounded-md font-mono">{optimizerConfig.simulacionesMontecarlo}</span>
          </div>
          <input
            type="range"
            min="1000"
            max="20000"
            step="1000"
            value={optimizerConfig.simulacionesMontecarlo}
            onChange={(e) => setOptimizerConfig(prev => ({ ...prev, simulacionesMontecarlo: parseInt(e.target.value) }))}
            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
          />
          <p className="text-xs text-gray-500">Define la precisión para calcular Pr[≥11]. Más es mejor pero más lento.</p>
        </div>

        {/* Los siguientes parámetros son para un futuro optimizador GRASP, pero los dejamos listos */}
        <div className="grid gap-2 opacity-50 cursor-not-allowed">
           <div className="flex justify-between items-center">
            <label className="font-medium text-sm">Iteraciones del Optimizador (futuro)</label>
            <span className="text-sm px-2 py-1 bg-gray-100 rounded-md font-mono">{optimizerConfig.iteracionesOptimizador}</span>
          </div>
           <input type="range" disabled className="w-full h-2 bg-gray-200 rounded-lg appearance-none" />
          <p className="text-xs text-gray-500">Para el optimizador GRASP-Annealing no implementado aún.</p>
        </div>
      </CardContent>
    </Card>
  );

  const renderResultados = () => {
    if (quinielasFinales.length === 0) {
      return (
        <Card>
          <CardContent className="p-8 text-center">
            <BarChart3 className="w-16 h-16 mx-auto mb-4 text-gray-400" />
            <h3 className="text-lg font-medium text-gray-600 mb-2">No hay resultados aún</h3>
            <p className="text-gray-500">Genera las quinielas primero para ver el análisis</p>
          </CardContent>
        </Card>
      );
    }

    const empatesPromedio = quinielasFinales.reduce((acc, q) => acc + q.resultados.filter((r:string) => r === 'E').length, 0) / quinielasFinales.length;
    const prob11Plus = quinielasFinales.reduce((acc, q) => acc + (q.prob_11_plus || 0), 0) / quinielasFinales.length;
    const probPortafolio = validacion?.metricas?.prob_portafolio_11_plus || 0;

    // Calcular distribución
    const totalPredicciones = quinielasFinales.length * 14;
    const conteos: { [key: string]: number } = { L: 0, E: 0, V: 0 };
    quinielasFinales.forEach(q => {
      q.resultados.forEach((r: string) => conteos[r]++);
    });
    const distribucion = {
      L: conteos.L / totalPredicciones,
      E: conteos.E / totalPredicciones,
      V: conteos.V / totalPredicciones
    };

    return (
      <div className="space-y-6">
        {/* Métricas principales */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{quinielasFinales.length}</div>
              <div className="text-sm text-gray-600">Total Quinielas</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{empatesPromedio.toFixed(1)}</div>
              <div className="text-sm text-gray-600">Empates Promedio</div>
              <div className="text-xs text-gray-500">Target: {PROGOL_CONFIG.EMPATES_PROMEDIO}</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-purple-600">{(prob11Plus * 100).toFixed(1)}%</div>
              <div className="text-sm text-gray-600">Pr[≥11] Promedio</div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-orange-600">{(probPortafolio * 100).toFixed(1)}%</div>
              <div className="text-sm text-gray-600">Pr[≥11] Portafolio</div>
            </CardContent>
          </Card>
        </div>

        {/* Distribución vs Target */}
        <Card>
          <CardHeader>
            <CardTitle>📊 Distribución vs Histórico</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              {['L', 'E', 'V'].map(resultado => {
                const actual = (distribucion as any)[resultado];
                const target = (PROGOL_CONFIG.DISTRIBUCION_HISTORICA as any)[resultado];
                const [min, max] = (PROGOL_CONFIG.RANGOS_HISTORICOS as any)[resultado];
                const enRango = actual >= min && actual <= max;

                return (
                  <div key={resultado} className="text-center">
                    <div className={`text-lg font-bold ${enRango ? 'text-green-600' : 'text-red-600'}`}>
                      {(actual * 100).toFixed(1)}%
                    </div>
                    <div className="text-sm text-gray-600">
                      {resultado === 'L' ? 'Locales' : resultado === 'E' ? 'Empates' : 'Visitantes'}
                    </div>
                    <div className="text-xs text-gray-500">
                      Target: {(target * 100).toFixed(1)}% ({(min * 100).toFixed(1)}-{(max * 100).toFixed(1)}%)
                    </div>
                    <div className={`text-xs ${enRango ? 'text-green-600' : 'text-red-600'}`}>
                      {enRango ? '✓ En rango' : '✗ Fuera de rango'}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Estado de validación */}
        {validacion && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {validacion.es_valido ? (
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-yellow-600" />
                )}
                Estado de Validación
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`p-4 rounded-lg ${validacion.es_valido ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
                <div className={`font-medium ${validacion.es_valido ? 'text-green-700' : 'text-yellow-700'}`}>
                  {validacion.es_valido ? '✅ Portafolio válido' : '⚠️ Portafolio con advertencias'}
                </div>

                {validacion.warnings.length > 0 && (
                  <div className="mt-2">
                    <div className="text-sm font-medium text-yellow-700 mb-1">Advertencias:</div>
                    <ul className="text-sm text-yellow-600 space-y-1">
                      {validacion.warnings.slice(0, 3).map((warning: string, i: number) => (
                        <li key={i}>• {warning}</li>
                      ))}
                      {validacion.warnings.length > 3 && (
                        <li>• ... y {validacion.warnings.length - 3} más</li>
                      )}
                    </ul>
                  </div>
                )}

                {validacion.errores.length > 0 && (
                  <div className="mt-2">
                    <div className="text-sm font-medium text-red-700 mb-1">Errores:</div>
                    <ul className="text-sm text-red-600 space-y-1">
                      {validacion.errores.map((error: string, i: number) => (
                        <li key={i}>• {error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tabla de quinielas */}
        <Card>
          <CardHeader>
            <CardTitle>📋 Todas las Quinielas</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">Q</th>
                    <th className="text-left p-2">Tipo</th>
                    {Array.from({length: 14}, (_, i) => (
                      <th key={i} className="text-center p-1 w-8">P{i+1}</th>
                    ))}
                    <th className="text-center p-2">E</th>
                    <th className="text-center p-2">Pr≥11</th>
                  </tr>
                </thead>
                <tbody>
                  {quinielasFinales.slice(0, 10).map((quiniela, i) => (
                    <tr key={i} className="border-b hover:bg-gray-50">
                      <td className="p-2 font-medium">Q-{i+1}</td>
                      <td className={`p-2 text-xs ${
                        quiniela.tipo === 'Core' ? 'text-green-600' : 'text-purple-600'
                      }`}>
                        {quiniela.tipo}
                      </td>
                      {quiniela.resultados.map((resultado: string, j: number) => (
                        <td key={j} className={`text-center p-1 font-mono ${
                          resultado === 'L' ? 'text-blue-600' :
                          resultado === 'E' ? 'text-gray-600' : 'text-red-600'
                        }`}>
                          {resultado}
                        </td>
                      ))}
                      <td className="text-center p-2">{quiniela.empates}</td>
                      <td className="text-center p-2">{((quiniela.prob_11_plus || 0) * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {quinielasFinales.length > 10 && (
                <div className="text-center p-4 text-gray-500 text-sm">
                  Mostrando las primeras 10 de {quinielasFinales.length} quinielas
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const renderExportacion = () => {
    if (quinielasFinales.length === 0) {
      return (
        <Card>
          <CardContent className="p-8 text-center">
            <FileDown className="w-16 h-16 mx-auto mb-4 text-gray-400" />
            <h3 className="text-lg font-medium text-gray-600 mb-2">No hay datos para exportar</h3>
            <p className="text-gray-500">Genera las quinielas primero para poder exportar</p>
          </CardContent>
        </Card>
      );
    }

    const generarCSV = () => {
      const headers = ['Quiniela', 'Tipo', ...Array.from({length: 14}, (_, i) => `P${i+1}`), 'Empates', 'Prob_11_Plus'];
      const rows = quinielasFinales.map((q, i) => [
        `Q-${i+1}`,
        q.tipo,
        ...q.resultados,
        q.empates,
        ((q.prob_11_plus || 0) * 100).toFixed(2)
      ]);

      const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `progol_quinielas_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    };

    const generarJSON = () => {
      const exportData = {
        metadata: {
          fecha_generacion: new Date().toISOString(),
          total_quinielas: quinielasFinales.length,
          metodologia: 'Core + Satélites GRASP-Annealing',
          distribucion_historica: PROGOL_CONFIG.DISTRIBUCION_HISTORICA
        },
        partidos: partidosRegular,
        quinielas: quinielasFinales,
        validacion: validacion
      };

      const jsonContent = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonContent], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `progol_quinielas_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    };

    const generarProgol = () => {
      const lines = [
        'PROGOL OPTIMIZER - QUINIELAS GENERADAS',
        '='.repeat(50),
        `Fecha: ${new Date().toLocaleString()}`,
        `Total de quinielas: ${quinielasFinales.length}`,
        `Metodología: Core + Satélites GRASP-Annealing`,
        '',
        'PARTIDOS:',
        ...partidosRegular.map((p, i) => `${String(i+1).padStart(2)}. ${p.local} vs ${p.visitante}`),
        '',
        'QUINIELAS:',
        ...quinielasFinales.map((q, i) => {
          const resultados = q.resultados.join(' ');
          const prob = ((q.prob_11_plus || 0) * 100).toFixed(1);
          return `Q-${String(i+1).padStart(2)} (${q.tipo.padStart(8)}): ${resultados} | E:${q.empates} | Pr:${prob}%`;
        })
      ];

      const content = lines.join('\n');
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `progol_boletos_${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    };

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileDown className="w-5 h-5" />
              Exportación de Resultados
            </CardTitle>
            <CardDescription>
              Descarga las quinielas en diferentes formatos
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <button
                onClick={generarCSV}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <FileDown className="w-4 h-4" />
                Descargar CSV
              </button>

              <button
                onClick={generarJSON}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <FileDown className="w-4 h-4" />
                Descargar JSON
              </button>

              <button
                onClick={generarProgol}
                className="flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                <FileDown className="w-4 h-4" />
                Formato Progol
              </button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>📊 Resumen del Portafolio</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{quinielasFinales.length}</div>
                <div className="text-sm text-gray-600">Total Quinielas</div>
              </div>

              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">
                  {quinielasFinales.reduce((acc, q) => acc + q.empates, 0)}
                </div>
                <div className="text-sm text-gray-600">Total Empates</div>
              </div>

              <div className="text-center">
                <div className="text-2xl font-bold text-purple-600">
                  ${quinielasFinales.length * 15}
                </div>
                <div className="text-sm text-gray-600">Costo Total (MXN)</div>
              </div>

              <div className="text-center">
                <div className="text-2xl font-bold text-orange-600">
                  {validacion?.metricas?.prob_portafolio_11_plus ?
                    (validacion.metricas.prob_portafolio_11_plus * 100).toFixed(1) : '0.0'}%
                </div>
                <div className="text-sm text-gray-600">Pr[≥11] Final</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  // ==================== RENDER PRINCIPAL ====================

  return (
    <div className="bg-red-500 text-white p-8">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Target className="w-8 h-8 text-blue-600" />
                Progol Optimizer
              </h1>
              <p className="text-gray-600">Metodología Definitiva Core + Satélites</p>
            </div>

            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-500">v1.0.0</span>
              <div className={`px-2 py-1 rounded text-xs ${
                Object.values(progress).filter(Boolean).length >= 3 ?
                'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'
              }`}>
                {Object.values(progress).filter(Boolean).length}/5 pasos
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {renderBarraProgreso()}

        {/* Navigation Tabs */}
        <div className="flex space-x-1 mb-6 bg-gray-100 p-1 rounded-lg overflow-x-auto">
          {[
            { id: 'datos', label: 'Datos', icon: Database },
            { id: 'generacion', label: 'Generación', icon: Zap },
            { id: 'configuracion', label: 'Configuración', icon: Settings },
            { id: 'resultados', label: 'Resultados', icon: BarChart3 },
            { id: 'exportacion', label: 'Exportar', icon: FileDown }
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-md font-medium transition-colors ${
                activeTab === id
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'datos' && renderEntradaDatos()}
        {activeTab === 'generacion' && renderGeneracion()}
        {activeTab === 'configuracion' && renderConfiguracion()}
        {activeTab === 'resultados' && renderResultados()}
        {activeTab === 'exportacion' && renderExportacion()}
      </div>
    </div>
  );
}