import { useEffect, useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useStartCheck, useStopCheck } from "@/hooks/use-checker";
import { useCheckerContext } from "@/lib/checker-context";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { 
  Play, 
  Square, 
  CreditCard, 
  Copy, 
  Coins,
  ChevronLeft,
  ChevronRight,
  Megaphone,
  Home as HomeIcon,
  User,
  Settings as SettingsIcon,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Upload,
  Loader2,
  CheckCircle2,
  XCircle,
  MessageCircle,
  FileUp,
  Eraser,
  Globe,
  X,
  Info,
  Gift,
  Download,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useAuth, authFetch } from "@/lib/auth";
import { useTutorial } from "@/lib/tutorial-context";
import { motion, AnimatePresence } from "framer-motion";
import { HelpCircle } from "lucide-react";
import { MusicToggleButton } from "@/components/BackgroundMusic";

interface Site {
  id: number;
  name: string;
  url: string;
  productPrice: string | null;
  isActive: boolean;
  isGlobal?: boolean;
}

interface CheckResult {
  id: number;
  card: string;
  status: string;
  message?: string | null;
}


export default function Home() {
  const { user, refreshUser } = useAuth();
  const { startTutorial } = useTutorial();
  const startCheck = useStartCheck();
  const stopCheck = useStopCheck();
  const { results, stats, clearLocalResults, fetchCheckStatus, cardsInput, setCardsInput } = useCheckerContext();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cardsInputState, setCardsInputState] = useState("");
  // Use context for cardsInput but allow local state for immediate feedback
  useEffect(() => {
    if (cardsInput && !cardsInputState) {
      setCardsInputState(cardsInput);
    }
  }, [cardsInput]);

  const handleCardsInputChange = (val: string) => {
    setCardsInputState(val);
    setCardsInput(val);
  };
  const [selectedSiteIndex, setSelectedSiteIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<"live" | "dead">("live");
  const [lastChargedCount, setLastChargedCount] = useState(0);
  const prevResultsRef = useRef<CheckResult[]>([]);
  const notifiedCardsRef = useRef<Set<number>>(new Set());
  const [isFocused, setIsFocused] = useState(false);
  const [showCardsHelp, setShowCardsHelp] = useState(false);
  const [showCreditsDialog, setShowCreditsDialog] = useState(false);

  const { data: sites = [] } = useQuery<Site[]>({
    queryKey: ['/api/sites'],
    queryFn: async () => {
      const res = await authFetch('/api/sites');
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: userStats } = useQuery({
    queryKey: ['/api/stats'],
    queryFn: async () => {
      const res = await authFetch('/api/stats');
      if (!res.ok) return null;
      return res.json();
    },
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (sites.length > 0) {
      const activeIndex = sites.findIndex(s => s.isActive);
      if (activeIndex >= 0) {
        setSelectedSiteIndex(activeIndex);
      } else {
        setSelectedSiteIndex(0);
      }
    }
  }, [sites]);

  useEffect(() => {
    fetchCheckStatus();
  }, [fetchCheckStatus]);

  useEffect(() => {
    if (stats.charged !== undefined || stats.rejected !== undefined) {
      refreshUser();
    }
  }, [stats.charged, stats.rejected]);

  useEffect(() => {
    const liveResults = results.filter(r => r.status === 'live');
    
    liveResults.forEach((card) => {
      if (!notifiedCardsRef.current.has(card.id)) {
        notifiedCardsRef.current.add(card.id);
        toast({
          title: "CHARGED!",
          description: (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <span className="font-mono text-xs">{card.card.substring(0, 20)}...</span>
            </div>
          ),
          className: "bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800",
          soundType: 'success',
        });
      }
    });
    
    prevResultsRef.current = results;
  }, [results, toast]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.txt')) {
      toast({
        title: "Invalid File",
        description: "Please upload a .txt file",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      handleCardsInputChange(cardsInputState ? cardsInputState + '\n' + content : content);
      toast({
        title: "File Loaded",
        description: `${content.split('\n').filter(l => l.trim()).length} cards imported`,
        soundType: 'default',
      });
    };
    reader.readAsText(file);
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Luhn algorithm for card validation
  const luhnCheck = (cardNum: string): boolean => {
    const digits = cardNum.replace(/\D/g, '');
    let sum = 0;
    let isEven = false;
    
    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = parseInt(digits[i], 10);
      
      if (isEven) {
        digit *= 2;
        if (digit > 9) {
          digit -= 9;
        }
      }
      
      sum += digit;
      isEven = !isEven;
    }
    
    return sum % 10 === 0;
  };

  // Extract card from various formats
  const extractCard = (line: string): string | null => {
    // Remove extra whitespace
    let cleaned = line.trim();
    
    // Try standard format: card|month|year|cvv
    let parts = cleaned.split('|');
    if (parts.length >= 4) {
      const [cardNum, expMonth, expYear, cvv] = parts;
      const cleanCard = cardNum.replace(/\s/g, '');
      const cleanMonth = expMonth.replace(/\D/g, '');
      const cleanYear = expYear.replace(/\D/g, '');
      const cleanCvv = cvv.replace(/\D/g, '');
      return `${cleanCard}|${cleanMonth}|${cleanYear}|${cleanCvv}`;
    }
    
    // Try colon format: card:month:year:cvv
    parts = cleaned.split(':');
    if (parts.length >= 4) {
      const [cardNum, expMonth, expYear, cvv] = parts;
      const cleanCard = cardNum.replace(/\s/g, '');
      const cleanMonth = expMonth.replace(/\D/g, '');
      const cleanYear = expYear.replace(/\D/g, '');
      const cleanCvv = cvv.replace(/\D/g, '');
      return `${cleanCard}|${cleanMonth}|${cleanYear}|${cleanCvv}`;
    }
    
    // Try space format: card month year cvv
    parts = cleaned.split(/\s+/);
    if (parts.length >= 4) {
      const [cardNum, expMonth, expYear, cvv] = parts;
      const cleanCard = cardNum.replace(/\s/g, '');
      const cleanMonth = expMonth.replace(/\D/g, '');
      const cleanYear = expYear.replace(/\D/g, '');
      const cleanCvv = cvv.replace(/\D/g, '');
      return `${cleanCard}|${cleanMonth}|${cleanYear}|${cleanCvv}`;
    }
    
    // Try to extract from messy format using regex
    const cardMatch = cleaned.match(/(\d{13,19})/);
    const expMatch = cleaned.match(/(\d{1,2})[\/\-]?(\d{2,4})/);
    const cvvMatch = cleaned.match(/\D(\d{3,4})$/);
    
    if (cardMatch && expMatch && cvvMatch) {
      const card = cardMatch[1];
      const month = expMatch[1].padStart(2, '0');
      const year = expMatch[2];
      const cvv = cvvMatch[1];
      return `${card}|${month}|${year}|${cvv}`;
    }
    
    return null;
  };

  const cleanCards = () => {
    const lines = cardsInputState.split('\n').map(l => l.trim()).filter(l => l);
    const validCards: string[] = [];
    const seen = new Set<string>();
    let removedDuplicates = 0;
    let removedExpired = 0;
    let removedInvalid = 0;
    let removedLuhn = 0;
    let fixedFormat = 0;
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    for (const line of lines) {
      // Try to extract card from various formats
      const extracted = extractCard(line);
      if (!extracted) {
        removedInvalid++;
        continue;
      }
      
      const parts = extracted.split('|');
      if (parts.length < 4) {
        removedInvalid++;
        continue;
      }

      const [cardNum, expMonth, expYear, cvv] = parts;
      
      // Check card number (13-19 digits)
      const cleanCardNum = cardNum.replace(/\s/g, '');
      if (!/^\d{13,19}$/.test(cleanCardNum)) {
        removedInvalid++;
        continue;
      }
      
      // Luhn validation
      if (!luhnCheck(cleanCardNum)) {
        removedLuhn++;
        continue;
      }

      // Check expiry
      const month = parseInt(expMonth);
      let year = parseInt(expYear);
      if (year < 100) year += 2000;
      
      if (isNaN(month) || month < 1 || month > 12) {
        removedInvalid++;
        continue;
      }

      if (year < currentYear || (year === currentYear && month < currentMonth)) {
        removedExpired++;
        continue;
      }

      // Check CVV (3-4 digits)
      if (!/^\d{3,4}$/.test(cvv)) {
        removedInvalid++;
        continue;
      }

      // Check duplicates
      const cardKey = cleanCardNum;
      if (seen.has(cardKey)) {
        removedDuplicates++;
        continue;
      }
      seen.add(cardKey);
      
      // Format the card properly
      const formattedMonth = month.toString().padStart(2, '0');
      const formattedYear = year.toString().slice(-2);
      const formattedCard = `${cleanCardNum}|${formattedMonth}|${formattedYear}|${cvv}`;
      
      // Track if format was fixed
      if (formattedCard !== line.trim()) {
        fixedFormat++;
      }
      
      validCards.push(formattedCard);
    }

    handleCardsInputChange(validCards.join('\n'));
    
    const total = removedDuplicates + removedExpired + removedInvalid + removedLuhn;
    if (total > 0 || fixedFormat > 0) {
      const messages = [];
      if (removedDuplicates > 0) messages.push(`${removedDuplicates} duplicates`);
      if (removedExpired > 0) messages.push(`${removedExpired} expired`);
      if (removedLuhn > 0) messages.push(`${removedLuhn} invalid (Luhn)`);
      if (removedInvalid > 0) messages.push(`${removedInvalid} invalid format`);
      if (fixedFormat > 0) messages.push(`${fixedFormat} fixed`);
      
      toast({
        title: "Cards Cleaned",
        description: messages.join(', '),
        soundType: 'success',
      });
    } else {
      toast({
        title: "All cards are valid",
        description: `${validCards.length} cards ready to check`,
      });
    }
  };

  const handleStart = async () => {
    if (!cardsInputState.trim()) {
      toast({
        title: "Input Required",
        description: "Please enter cards to check.",
        variant: "destructive",
      });
      return;
    }
    
    const cards = cardsInputState.split('\n').map(c => c.trim()).filter(c => c.length > 0);
    if (cards.length === 0) return;

    if (!user?.isAdmin && (user?.credits || 0) < cards.length) {
      toast({
        title: "Insufficient Credits",
        description: `You need ${cards.length} credits but only have ${user?.credits || 0}.`,
        variant: "destructive",
      });
      return;
    }
    
    clearLocalResults();
    prevResultsRef.current = [];
    notifiedCardsRef.current.clear();
    const selectedSite = sites[selectedSiteIndex];
    startCheck.mutate({ cards, siteId: selectedSite?.id });
  };

  const handleStop = () => {
    stopCheck.mutate();
  };

  const liveResults = results.filter(r => r.status === 'live');
  const deadResults = results.filter(r => r.status === 'dead');

  const copyCard = (card: string) => {
    navigator.clipboard.writeText(card);
    toast({ title: "Copied!", duration: 1500 });
  };

  const selectedSite = sites[selectedSiteIndex];

  const nextSite = () => {
    if (sites.length > 0 && !stats.active) {
      setSelectedSiteIndex((prev) => (prev + 1) % sites.length);
    }
  };

  const prevSite = () => {
    if (sites.length > 0 && !stats.active) {
      setSelectedSiteIndex((prev) => (prev - 1 + sites.length) % sites.length);
    }
  };

  const displayedResults = activeTab === "live" ? liveResults : deadResults;

  const openOwnerChat = () => {
    window.open('https://t.me/lucee7', '_blank');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col pb-20">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".txt"
        className="hidden"
      />
      
      <header className="px-4 pt-4 pb-2" data-tutorial="header">
        <motion.div 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-4"
        >
          <motion.button 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowCreditsDialog(true)}
            className="flex items-center gap-2 bg-gradient-to-r from-emerald-500/10 to-emerald-400/5 px-3 py-1.5 rounded-full border border-emerald-500/20 cursor-pointer"
            data-testid="button-credits"
          >
            <Coins className="w-4 h-4 text-emerald-500" />
            <motion.span 
              key={user?.credits}
              initial={{ scale: 1.2 }}
              animate={{ scale: 1 }}
              className="font-bold text-sm text-emerald-600 dark:text-emerald-400"
              data-testid="credits-balance"
            >
              {user?.credits || 0}
            </motion.span>
            <HelpCircle className="w-3 h-3 text-emerald-500/50" />
          </motion.button>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-4 text-xs">
              <motion.div 
                whileHover={{ scale: 1.05 }}
                className="flex items-center gap-1.5 bg-emerald-500/10 px-2.5 py-1 rounded-full"
              >
                <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  {userStats?.totalCharged || 0}
                </span>
              </motion.div>
              <motion.div 
                whileHover={{ scale: 1.05 }}
                className="flex items-center gap-1.5 bg-rose-500/10 px-2.5 py-1 rounded-full"
              >
                <TrendingDown className="w-3.5 h-3.5 text-rose-500" />
                <span className="font-bold text-rose-600 dark:text-rose-400">
                  {userStats?.totalRejected || 0}
                </span>
              </motion.div>
            </div>
            
            <MusicToggleButton />
            
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={startTutorial}
              className="p-2 rounded-full bg-purple-500/10 border border-purple-500/20"
              data-testid="button-tutorial"
            >
              <HelpCircle className="w-4 h-4 text-purple-500" />
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={openOwnerChat}
              className="p-2 rounded-full bg-blue-500/10 border border-blue-500/20"
              data-testid="button-contact-owner"
            >
              <MessageCircle className="w-4 h-4 text-blue-500" />
            </motion.button>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center mb-4"
        >
          <div className="inline-flex items-center gap-2">
            <motion.div
              animate={{ rotate: [0, 15, -15, 0] }}
              transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
            >
              <Sparkles className="w-5 h-5 text-purple-400" />
            </motion.div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-600 via-pink-500 to-rose-500 dark:from-purple-400 dark:via-pink-400 dark:to-rose-400 bg-clip-text text-transparent">
              NexusChecker
            </h1>
            <motion.div
              animate={{ rotate: [0, -15, 15, 0] }}
              transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
            >
              <Sparkles className="w-5 h-5 text-rose-400" />
            </motion.div>
          </div>
          <motion.button
            onClick={openOwnerChat}
            whileHover={{ scale: 1.05 }}
            className="text-xs text-blue-500 mt-1 flex items-center gap-1 mx-auto"
          >
            <span>@lucee7</span>
          </motion.button>
        </motion.div>
      </header>

      <main className="flex-1 px-4 space-y-4">
        
        <motion.a
          href="https://t.me/+RBJbJ2A_JpNiODU0"
          target="_blank"
          rel="noopener noreferrer"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="flex items-center gap-3 p-3 rounded-2xl bg-gradient-to-r from-sky-500/15 to-blue-500/10 border border-sky-500/30 hover:border-sky-500/50 hover:from-sky-500/20 transition-colors"
          data-testid="button-join-channel"
        >
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shrink-0 shadow-lg shadow-sky-500/20">
            <Megaphone className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Join Our Telegram Channel</p>
            <p className="text-xs text-muted-foreground">Get updates, drops and exclusive bonuses</p>
          </div>
          <ChevronRight className="w-4 h-4 text-sky-500 shrink-0" />
        </motion.a>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className={`relative rounded-2xl overflow-hidden ${
            isFocused ? 'neon-border-active' : ''
          }`}
          style={{
            background: isFocused 
              ? 'linear-gradient(135deg, rgba(168, 85, 247, 0.05), rgba(59, 130, 246, 0.05))'
              : undefined
          }}
        >
          <div className={`absolute inset-0 rounded-2xl transition-opacity duration-500 ${
            isFocused ? 'opacity-100' : 'opacity-0'
          }`} style={{
            background: 'linear-gradient(90deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3, #ff0000)',
            backgroundSize: '400% 100%',
            animation: isFocused ? 'rainbowBorder 4s linear infinite' : 'none',
            padding: '2px',
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            filter: 'brightness(1.2) saturate(1.3)',
          }} />
          
          <div className="bg-card rounded-2xl border border-border shadow-lg overflow-hidden relative" data-tutorial="cards-input">
            {/* X button to clear all cards */}
            <AnimatePresence>
              {cardsInputState.trim() && !stats.active && (
                <motion.button
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => handleCardsInputChange('')}
                  className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-muted/80 hover:bg-destructive/20 border border-border transition-colors"
                  data-testid="button-clear-cards"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                </motion.button>
              )}
            </AnimatePresence>
            
            {/* Overlay when checking is in progress */}
            <AnimatePresence>
              {stats.active && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-20 bg-background/60 backdrop-blur-sm flex items-center justify-center rounded-2xl"
                >
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <span className="text-sm font-medium text-muted-foreground">Checking in progress...</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            
            <Textarea 
              value={cardsInputState}
              onChange={(e) => handleCardsInputChange(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="Paste your cards here...&#10;Format: 4111111111111111|12|2025|123"
              className="border-0 min-h-[140px] resize-none bg-transparent focus-visible:ring-0 font-mono text-sm p-4 leading-relaxed placeholder:text-muted-foreground/50"
              spellCheck={false}
              disabled={stats.active}
              data-testid="input-cards"
            />
            <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <motion.button 
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 hover:bg-purple-500/20 transition-colors"
                  data-testid="button-upload-file"
                >
                  <FileUp className="w-4 h-4 text-purple-500" />
                </motion.button>
                <motion.button 
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={cleanCards}
                  disabled={!cardsInput.trim()}
                  className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                  data-testid="button-clean-cards"
                >
                  <Eraser className="w-4 h-4 text-amber-500" />
                </motion.button>
                <Button 
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowCardsHelp(true)}
                  className="rounded-xl bg-blue-500/10 border border-blue-500/20"
                  data-testid="button-cards-help"
                >
                  <Info className="w-4 h-4 text-blue-500" />
                </Button>
              </div>
              <motion.div 
                key={cardsInputState.split('\n').filter(l => l.trim().length > 0).length}
                initial={{ scale: 1.1 }}
                animate={{ scale: 1 }}
                className="flex items-center gap-2 text-xs font-mono px-3 py-1.5 bg-muted rounded-lg text-muted-foreground"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>{cardsInputState.split('\n').filter(l => l.trim().length > 0).length} cards</span>
              </motion.div>
              <Link href="/settings">
                <motion.button 
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  className="p-2.5 rounded-xl hover:bg-muted transition-colors"
                >
                  <SettingsIcon className="w-4 h-4 text-muted-foreground" />
                </motion.button>
              </Link>
            </div>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="flex items-center justify-center gap-3"
          data-tutorial="site-selector"
        >
          <Button
            variant="ghost"
            size="icon"
            onClick={prevSite}
            disabled={sites.length <= 1 || stats.active}
            className="rounded-full h-10 w-10 border border-border"
            data-testid="button-prev-site"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          
          <AnimatePresence mode="wait">
            <motion.div 
              key={selectedSiteIndex}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 max-w-[250px]"
            >
              {sites.length === 0 ? (
                <Link href="/settings">
                  <div className={`text-center text-sm text-muted-foreground py-2.5 px-4 bg-muted rounded-xl cursor-pointer border-2 border-dashed border-border ${stats.active ? 'opacity-50 pointer-events-none' : ''}`}>
                    + Add Site
                  </div>
                </Link>
              ) : (
                <div className={`text-center py-2.5 px-4 bg-card rounded-xl border border-border ${stats.active ? 'opacity-50' : ''}`}>
                  <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                    <CreditCard className="w-4 h-4 text-purple-500 shrink-0" />
                    <span className="font-semibold text-sm leading-tight break-words" title={selectedSite?.name} data-testid="selected-site-name">
                      {selectedSite?.name || 'Select'}
                    </span>
                    {selectedSite?.isGlobal && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400">
                        Global
                      </span>
                    )}
                    {selectedSite?.productPrice && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono">
                        {selectedSite.productPrice}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
          
          <Button
            variant="ghost"
            size="icon"
            onClick={nextSite}
            disabled={sites.length <= 1 || stats.active}
            className="rounded-full h-10 w-10 border border-border"
            data-testid="button-next-site"
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="flex gap-3"
        >
          <Button 
            onClick={handleStart}
            disabled={stats.active || startCheck.isPending || sites.length === 0}
            className="flex-1 h-12 rounded-xl font-semibold text-base bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white shadow-lg shadow-purple-500/20 border-0"
            data-testid="button-start"
            data-tutorial="start-button"
          >
            {stats.active ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <Play className="w-5 h-5 mr-2 fill-current" />
                Start Check
              </>
            )}
          </Button>

          <Button 
            onClick={handleStop}
            disabled={!stats.active || stopCheck.isPending}
            variant="outline"
            className="h-12 px-6 rounded-xl font-semibold border-2"
            data-testid="button-stop"
          >
            <Square className="w-5 h-5" />
          </Button>
        </motion.div>

        {stats.active && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="text-center text-sm text-muted-foreground"
          >
            <span className="font-mono">{stats.processed}</span>
            <span className="opacity-50"> / </span>
            <span className="font-mono">{stats.total}</span>
            <span className="opacity-50 ml-2">processed</span>
          </motion.div>
        )}

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="flex gap-2 p-1.5 bg-muted rounded-2xl"
          data-tutorial="results"
        >
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => setActiveTab("live")}
            className={`flex-1 py-3 px-4 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
              activeTab === "live"
                ? "bg-card text-emerald-600 dark:text-emerald-400 shadow-md"
                : "text-muted-foreground"
            }`}
            data-testid="tab-live"
          >
            <CheckCircle2 className="w-4 h-4" />
            LIVE ({liveResults.length})
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => setActiveTab("dead")}
            className={`flex-1 py-3 px-4 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
              activeTab === "dead"
                ? "bg-card text-rose-600 dark:text-rose-400 shadow-md"
                : "text-muted-foreground"
            }`}
            data-testid="tab-dead"
          >
            <XCircle className="w-4 h-4" />
            DECLINED ({deadResults.length})
          </motion.button>
        </motion.div>

        {(liveResults.length > 0 || deadResults.length > 0) && (
          <div className="flex justify-end gap-2 mb-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  const type = activeTab === "live" ? "approved" : "declined";
                  const res = await authFetch(`/api/results/export?type=${type}`);
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `nexus-${type}-${Date.now()}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                  toast({ title: "Export complete!", soundType: "success" });
                } catch {
                  toast({ title: "Export failed", variant: "destructive" });
                }
              }}
              data-testid="button-export-results"
            >
              <Download className="w-4 h-4 mr-2" />
              Export {activeTab === "live" ? "Live" : "Dead"}
            </Button>
          </div>
        )}

        <div className="space-y-3 pb-4">
          <AnimatePresence mode="popLayout">
            {displayedResults.length === 0 ? (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-16"
              >
                <motion.div
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${
                    activeTab === "live" 
                      ? "bg-emerald-100 dark:bg-emerald-500/20" 
                      : "bg-rose-100 dark:bg-rose-500/20"
                  }`}
                >
                  {activeTab === "live" ? (
                    <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                  ) : (
                    <XCircle className="w-8 h-8 text-rose-500" />
                  )}
                </motion.div>
                <p className="text-muted-foreground text-sm">
                  {activeTab === "live" ? "No live cards yet" : "No declined cards yet"}
                </p>
              </motion.div>
            ) : (
              displayedResults.map((result, index) => (
                <motion.div
                  key={result.id}
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, x: -50 }}
                  transition={{ delay: index * 0.02 }}
                  className={`rounded-2xl p-4 shadow-sm border ${
                    result.status === 'live' 
                      ? 'bg-gradient-to-r from-emerald-50 to-emerald-100/50 dark:from-emerald-500/10 dark:to-emerald-500/5 border-emerald-200 dark:border-emerald-500/20' 
                      : 'bg-gradient-to-r from-rose-50 to-rose-100/50 dark:from-rose-500/10 dark:to-rose-500/5 border-rose-200 dark:border-rose-500/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <motion.span 
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className={`w-3 h-3 rounded-full ${
                            result.status === 'live' ? 'bg-emerald-500' : 'bg-rose-500'
                          }`} 
                        />
                        <p className="font-mono text-xs font-medium truncate">
                          {result.card}
                        </p>
                      </div>
                      {selectedSite && (
                        <div className="flex items-center gap-1.5 mb-2 ml-5">
                          <Globe className="w-3 h-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground font-medium truncate">
                            {selectedSite.name}
                          </span>
                        </div>
                      )}
                      <p className={`text-sm font-bold ${
                        result.status === 'live' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}>
                        {result.status === 'live' ? (result.message || 'LIVE') : (result.message || 'DECLINED')}
                      </p>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => copyCard(result.card)}
                      className={`p-2.5 rounded-xl ${
                        result.status === 'live' 
                          ? 'bg-emerald-200/50 dark:bg-emerald-500/20' 
                          : 'bg-rose-200/50 dark:bg-rose-500/20'
                      }`}
                    >
                      <Copy className={`w-4 h-4 ${
                        result.status === 'live' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`} />
                    </motion.button>
                  </div>
                </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>

      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-background/90 backdrop-blur-xl border-t border-border px-4 py-3 z-50">
        <div className="flex items-center justify-around max-w-md mx-auto">
          <Link href="/">
            <motion.button 
              whileTap={{ scale: 0.95 }}
              className="flex flex-col items-center gap-1.5 py-1 px-8"
              data-testid="nav-home"
            >
              <div className="p-2 rounded-xl bg-purple-500/10">
                <HomeIcon className="w-5 h-5 text-purple-500" />
              </div>
              <span className="text-[10px] font-semibold text-purple-500">Home</span>
            </motion.button>
          </Link>
          <Link href="/rewards">
            <motion.button 
              whileTap={{ scale: 0.95 }}
              className="flex flex-col items-center gap-1.5 py-1 px-6"
              data-testid="nav-rewards"
            >
              <div className="p-2">
                <Gift className="w-5 h-5 text-muted-foreground" />
              </div>
              <span className="text-[10px] font-medium text-muted-foreground">Rewards</span>
            </motion.button>
          </Link>
          <Link href="/profile">
            <motion.button 
              whileTap={{ scale: 0.95 }}
              className="flex flex-col items-center gap-1.5 py-1 px-6"
              data-testid="nav-profile"
            >
              <div className="p-2">
                <User className="w-5 h-5 text-muted-foreground" />
              </div>
              <span className="text-[10px] font-medium text-muted-foreground">Profile</span>
            </motion.button>
          </Link>
          <Link href="/settings">
            <motion.button 
              whileTap={{ scale: 0.95 }}
              className="flex flex-col items-center gap-1.5 py-1 px-6"
              data-testid="nav-settings"
              data-tutorial="settings-nav"
            >
              <div className="p-2">
                <SettingsIcon className="w-5 h-5 text-muted-foreground" />
              </div>
              <span className="text-[10px] font-medium text-muted-foreground">Settings</span>
            </motion.button>
          </Link>
        </div>
      </nav>

      {/* Cards Help Popup */}
      <AnimatePresence>
        {showCardsHelp && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowCardsHelp(false)}
            data-testid="overlay-cards-help"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-card border border-border rounded-3xl p-6 max-w-md w-full max-h-[85vh] overflow-y-auto shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              data-testid="popup-cards-help"
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-xl font-bold flex items-center gap-2" data-testid="text-cards-help-title">
                  <CreditCard className="w-5 h-5 text-primary" />
                  Card Format Guide
                </h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowCardsHelp(false)}
                  className="rounded-xl"
                  data-testid="button-close-cards-help"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-5">
                {/* Card Format Section */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Supported Formats</h3>
                  <div className="bg-muted/50 rounded-xl p-4 space-y-2 font-mono text-xs">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                      <span>4111111111111111|12|2025|123</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                      <span>4111111111111111|12|25|123</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />
                      <span>4111111111111111|1225|123</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Format: <span className="font-mono">CardNumber|Month|Year|CVV</span>
                  </p>
                </div>

                {/* Clean Feature Section */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                    <Eraser className="w-4 h-4 text-amber-500" />
                    Clean Feature
                  </h3>
                  <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-xl p-4">
                    <p className="text-sm mb-3">The clean button automatically:</p>
                    <ul className="space-y-2 text-sm">
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                        <span>Removes duplicate cards</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                        <span>Removes expired cards (past dates)</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                        <span>Removes invalid format cards</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
                        <span>Fixes format issues (MMYY to MM|YY)</span>
                      </li>
                    </ul>
                  </div>
                </div>

                {/* Interactive Animation Tutorial */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">How It Works</h3>
                  <div className="rounded-xl overflow-hidden border border-border bg-gradient-to-br from-slate-900 to-slate-800 p-4">
                    {/* Animated Demo */}
                    <div className="space-y-4">
                      {/* Step 1: Paste Cards */}
                      <motion.div 
                        className="flex items-start gap-3"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.2 }}
                      >
                        <div className="w-7 h-7 rounded-full bg-purple-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">1</div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-white mb-2">Paste your cards</p>
                          <motion.div 
                            className="bg-slate-700/50 rounded-lg p-2 font-mono text-[10px] text-green-400 overflow-hidden"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.5 }}
                          >
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: [0, 1, 1, 1] }}
                              transition={{ delay: 0.7, duration: 2, times: [0, 0.1, 0.5, 1] }}
                            >
                              4111111111111111|12|2025|123
                            </motion.div>
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: [0, 1, 1, 1] }}
                              transition={{ delay: 1.2, duration: 2, times: [0, 0.1, 0.5, 1] }}
                            >
                              5500000000000004|08|26|456
                            </motion.div>
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: [0, 1, 1, 1] }}
                              transition={{ delay: 1.7, duration: 2, times: [0, 0.1, 0.5, 1] }}
                              className="text-red-400 line-through"
                            >
                              4111111111111111|01|2020|999
                            </motion.div>
                          </motion.div>
                        </div>
                      </motion.div>

                      {/* Step 2: Clean Cards */}
                      <motion.div 
                        className="flex items-start gap-3"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 2.2 }}
                      >
                        <div className="w-7 h-7 rounded-full bg-amber-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">2</div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-white mb-2">Click Clean button</p>
                          <div className="flex items-center gap-2">
                            <motion.div 
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/30"
                              animate={{ 
                                scale: [1, 1.1, 1],
                                boxShadow: ['0 0 0 0 rgba(245, 158, 11, 0)', '0 0 0 8px rgba(245, 158, 11, 0.3)', '0 0 0 0 rgba(245, 158, 11, 0)']
                              }}
                              transition={{ delay: 2.5, duration: 1, repeat: Infinity, repeatDelay: 3 }}
                            >
                              <Eraser className="w-3.5 h-3.5 text-amber-500" />
                              <span className="text-xs font-medium text-amber-500">Clean</span>
                            </motion.div>
                            <motion.div
                              initial={{ opacity: 0, scale: 0 }}
                              animate={{ opacity: 1, scale: 1 }}
                              transition={{ delay: 3.5 }}
                              className="flex items-center gap-1 text-[10px] text-green-400"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Expired removed!</span>
                            </motion.div>
                          </div>
                        </div>
                      </motion.div>

                      {/* Step 3: Start Check */}
                      <motion.div 
                        className="flex items-start gap-3"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 4 }}
                      >
                        <div className="w-7 h-7 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">3</div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-white mb-2">Start checking</p>
                          <div className="flex items-center gap-2">
                            <motion.div 
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/20 border border-green-500/30"
                              animate={{ 
                                scale: [1, 1.1, 1],
                                boxShadow: ['0 0 0 0 rgba(34, 197, 94, 0)', '0 0 0 8px rgba(34, 197, 94, 0.3)', '0 0 0 0 rgba(34, 197, 94, 0)']
                              }}
                              transition={{ delay: 4.3, duration: 1, repeat: Infinity, repeatDelay: 3 }}
                            >
                              <Play className="w-3.5 h-3.5 text-green-500" />
                              <span className="text-xs font-medium text-green-500">Start</span>
                            </motion.div>
                          </div>
                        </div>
                      </motion.div>

                      {/* Step 4: Results */}
                      <motion.div 
                        className="flex items-start gap-3"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 5 }}
                      >
                        <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">4</div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-white mb-2">View results</p>
                          <div className="space-y-1.5">
                            <motion.div 
                              className="flex items-center gap-2 px-2 py-1 rounded bg-green-500/20 border border-green-500/30"
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: 5.5 }}
                            >
                              <CheckCircle2 className="w-3 h-3 text-green-500" />
                              <span className="text-[10px] font-mono text-green-400">4111****1111 - APPROVED</span>
                            </motion.div>
                            <motion.div 
                              className="flex items-center gap-2 px-2 py-1 rounded bg-red-500/20 border border-red-500/30"
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ delay: 6 }}
                            >
                              <XCircle className="w-3 h-3 text-red-500" />
                              <span className="text-[10px] font-mono text-red-400">5500****0004 - DECLINED</span>
                            </motion.div>
                          </div>
                        </div>
                      </motion.div>
                    </div>
                  </div>
                </div>

                {/* Tips */}
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                    <Info className="w-4 h-4 text-blue-500" />
                    Pro Tips
                  </h4>
                  <ul className="text-xs space-y-1.5 text-muted-foreground">
                    <li>• Use the upload button to import cards from .txt files</li>
                    <li>• Always clean cards before checking to save credits</li>
                    <li>• Each card check costs 1 credit</li>
                  </ul>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Credits Dialog */}
      <AnimatePresence>
        {showCreditsDialog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowCreditsDialog(false)}
            data-testid="overlay-credits-dialog"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-card border border-border rounded-3xl p-6 max-w-sm w-full shadow-2xl"
              onClick={(e) => e.stopPropagation()}
              data-testid="popup-credits-dialog"
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-xl font-bold flex items-center gap-2">
                  <Coins className="w-5 h-5 text-emerald-500" />
                  Get Credits
                </h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowCreditsDialog(false)}
                  className="rounded-xl"
                  data-testid="button-close-credits-dialog"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-4">
                <p className="text-sm text-muted-foreground text-center">
                  Need more credits? Here's how to get them:
                </p>

                {/* Daily Rewards Option */}
                <Link href="/rewards" onClick={() => setShowCreditsDialog(false)}>
                  <motion.div 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    className="flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 cursor-pointer"
                    data-testid="button-credits-rewards"
                  >
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                      <Gift className="w-6 h-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-sm">Daily Rewards</p>
                      <p className="text-xs text-muted-foreground">Spin wheel, streaks & referrals</p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </motion.div>
                </Link>

                {/* Contact Admin Option */}
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => {
                    window.open('https://t.me/lucee7', '_blank');
                    setShowCreditsDialog(false);
                  }}
                  className="w-full flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-500/30 cursor-pointer"
                  data-testid="button-credits-contact"
                >
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                    <MessageCircle className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 text-left">
                    <p className="font-bold text-sm">Contact Admin</p>
                    <p className="text-xs text-muted-foreground">@lucee7 on Telegram</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                </motion.button>

                {/* Current Credits Display */}
                <div className="text-center pt-2">
                  <p className="text-xs text-muted-foreground">Your current balance</p>
                  <p className="text-2xl font-bold text-emerald-500">{user?.credits || 0} Credits</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
