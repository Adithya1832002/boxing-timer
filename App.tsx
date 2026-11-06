
import React, { useEffect, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  StyleSheet,
  ScrollView,
  Alert,
  Pressable,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// --------------------------------------------------
// TYPES
// --------------------------------------------------

type Workout = {
  id: string;
  name: string;
  sets: number;
  setTimeSeconds: number;
  restTimeSeconds: number;
  warmupTimeSeconds: number;
  isStandard: boolean;
};

type WorkoutForm = {
  name: string;
  sets: string;
  setMinutes: string;
  setSeconds: string;
  restMinutes: string;
  restSeconds: string;
  warmupMinutes: string;
  warmupSeconds: string;
};

type Phase = 'warmup' | 'round' | 'rest';

type Segment = {
  phase: Phase;
  round: number;
  duration: number;
  start: number;
  end: number;
};

type TimerStatus = 'ready' | 'running' | 'paused' | 'completed';
type Screen = 'home' | 'create' | 'timer';

const STORAGE_KEY = '@boxing_timer_saved_workouts';

const STANDARD_WORKOUT: Workout = {
  id: 'standard-boxing',
  name: 'Standard Boxing',
  sets: 3,
  setTimeSeconds: 180,
  restTimeSeconds: 60,
  warmupTimeSeconds: 30,
  isStandard: true,
};

const EMPTY_FORM: WorkoutForm = {
  name: '',
  sets: '3',
  setMinutes: '3',
  setSeconds: '00',
  restMinutes: '1',
  restSeconds: '00',
  warmupMinutes: '0',
  warmupSeconds: '30',
};

// --------------------------------------------------
// HELPER FUNCTIONS
// --------------------------------------------------

function formatTime(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function toTotalSeconds(minutes: string, seconds: string): number {
  return Number(minutes || 0) * 60 + Number(seconds || 0);
}

function secondsToFormValue(totalSeconds: number) {
  return {
    minutes: String(Math.floor(totalSeconds / 60)),
    seconds: String(totalSeconds % 60).padStart(2, '0'),
  };
}

function workoutToForm(workout: Workout): WorkoutForm {
  const setTime = secondsToFormValue(workout.setTimeSeconds);
  const restTime = secondsToFormValue(workout.restTimeSeconds);
  const warmupTime = secondsToFormValue(workout.warmupTimeSeconds);

  return {
    name: workout.name,
    sets: String(workout.sets),
    setMinutes: setTime.minutes,
    setSeconds: setTime.seconds,
    restMinutes: restTime.minutes,
    restSeconds: restTime.seconds,
    warmupMinutes: warmupTime.minutes,
    warmupSeconds: warmupTime.seconds,
  };
}

function workoutDuration(workout: Workout): number {
  return (
    workout.warmupTimeSeconds +
    workout.sets * workout.setTimeSeconds +
    Math.max(0, workout.sets - 1) * workout.restTimeSeconds
  );
}

function buildWorkoutPlan(workout: Workout): Segment[] {
  const plan: Segment[] = [];
  let currentTime = 0;

  const addSegment = (
    phase: Phase,
    round: number,
    duration: number,
  ) => {
    if (duration <= 0) return;

    plan.push({
      phase,
      round,
      duration,
      start: currentTime,
      end: currentTime + duration,
    });

    currentTime += duration;
  };

  addSegment('warmup', 0, workout.warmupTimeSeconds);

  for (let round = 1; round <= workout.sets; round++) {
    addSegment('round', round, workout.setTimeSeconds);

    if (round < workout.sets) {
      addSegment('rest', round, workout.restTimeSeconds);
    }
  }

  return plan;
}

// Supports previously saved configurations from the earlier app version.
function migrateWorkout(item: Record<string, unknown>): Workout | null {
  if (
    typeof item.id !== 'string' ||
    typeof item.name !== 'string'
  ) {
    return null;
  }

  const isStandard =
    item.isStandard === true ||
    item.id === STANDARD_WORKOUT.id;

  if (isStandard) {
    return STANDARD_WORKOUT;
  }

  // New storage format.
  if (
    typeof item.setTimeSeconds === 'number' &&
    typeof item.restTimeSeconds === 'number' &&
    typeof item.warmupTimeSeconds === 'number'
  ) {
    return {
      id: item.id,
      name: item.name,
      sets: Number(item.sets) || 1,
      setTimeSeconds: item.setTimeSeconds,
      restTimeSeconds: item.restTimeSeconds,
      warmupTimeSeconds: item.warmupTimeSeconds,
      isStandard: false,
    };
  }

  // Previous storage format: separate minute and second strings.
  if (
    typeof item.setMinutes === 'string' &&
    typeof item.setSeconds === 'string'
  ) {
    return {
      id: item.id,
      name: item.name,
      sets: Number(item.sets) || 1,
      setTimeSeconds: toTotalSeconds(
        item.setMinutes,
        item.setSeconds,
      ),
      restTimeSeconds: toTotalSeconds(
        String(item.restMinutes ?? '0'),
        String(item.restSeconds ?? '0'),
      ),
      warmupTimeSeconds: toTotalSeconds(
        String(item.warmupMinutes ?? '0'),
        String(item.warmupSeconds ?? '0'),
      ),
      isStandard: false,
    };
  }

  return null;
}

// --------------------------------------------------
// MAIN APP
// --------------------------------------------------

export default function App() {
  // Navigation
  const [screen, setScreen] = useState<Screen>('home');

  // Workouts
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [storageLoaded, setStorageLoaded] = useState(false);

  // Create/edit form
  const [form, setForm] = useState<WorkoutForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Selected workout
  const [selectedWorkout, setSelectedWorkout] =
    useState<Workout | null>(null);

  // Timer
  const [status, setStatus] = useState<TimerStatus>('ready');
  const [plan, setPlan] = useState<Segment[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  // ------------------------------------------------
  // STORAGE
  // ------------------------------------------------

  useEffect(() => {
    const loadWorkouts = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);

        let customWorkouts: Workout[] = [];

        if (stored) {
          const parsed: unknown = JSON.parse(stored);

          if (Array.isArray(parsed)) {
            customWorkouts = parsed
              .map(item =>
                migrateWorkout(item as Record<string, unknown>),
              )
              .filter(
                (item): item is Workout =>
                  item !== null && !item.isStandard,
              );
          }
        }

        // Standard Boxing always appears first.
        const initialWorkouts = [
          STANDARD_WORKOUT,
          ...customWorkouts.filter(
            item => item.id !== STANDARD_WORKOUT.id,
          ),
        ];

        setWorkouts(initialWorkouts);

        await AsyncStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(initialWorkouts),
        );
      } catch (error) {
        Alert.alert(
          'Storage error',
          'Could not load saved workouts.',
        );

        setWorkouts([STANDARD_WORKOUT]);
      } finally {
        setStorageLoaded(true);
      }
    };

    loadWorkouts();
  }, []);

  const persistWorkouts = async (updatedWorkouts: Workout[]) => {
    try {
      const orderedWorkouts = [
        STANDARD_WORKOUT,
        ...updatedWorkouts.filter(item => !item.isStandard),
      ];

      await AsyncStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(orderedWorkouts),
      );

      setWorkouts(orderedWorkouts);
      return true;
    } catch (error) {
      Alert.alert(
        'Storage error',
        'Could not save your workouts. Please try again.',
      );

      return false;
    }
  };

  // ------------------------------------------------
  // FORM MANAGEMENT
  // ------------------------------------------------

  const updateForm = (key: keyof WorkoutForm, value: string) => {
    const cleanedValue = value.replace(/[^0-9]/g, '');

    setForm(current => ({
      ...current,
      [key]: cleanedValue,
    }));
  };

  const openCreateScreen = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setScreen('create');
  };

  const openEditScreen = (workout: Workout) => {
    if (workout.isStandard) return;

    setEditingId(workout.id);
    setForm(workoutToForm(workout));
    setScreen('create');
  };

  const saveWorkout = async () => {
    const name = form.name.trim();
    const sets = Number(form.sets);

    const setTime = toTotalSeconds(
      form.setMinutes,
      form.setSeconds,
    );

    const restTime = toTotalSeconds(
      form.restMinutes,
      form.restSeconds,
    );

    const warmupTime = toTotalSeconds(
      form.warmupMinutes,
      form.warmupSeconds,
    );

    const validSeconds =
      Number(form.setSeconds) <= 59 &&
      Number(form.restSeconds) <= 59 &&
      Number(form.warmupSeconds) <= 59;

    const validMinutes =
      Number(form.setMinutes) <= 999 &&
      Number(form.restMinutes) <= 999 &&
      Number(form.warmupMinutes) <= 999;

    if (!name) {
      Alert.alert('Workout name required', 'Please enter a workout name.');
      return;
    }

    if (
      !Number.isInteger(sets) ||
      sets < 1 ||
      sets > 99 ||
      !validSeconds ||
      !validMinutes ||
      setTime <= 0
    ) {
      Alert.alert(
        'Invalid settings',
        'Enter 1–99 sets, a positive set duration, and seconds between 00 and 59.',
      );
      return;
    }

    const duplicateName = workouts.some(
      workout =>
        workout.name.toLowerCase() === name.toLowerCase() &&
        workout.id !== editingId,
    );

    if (duplicateName) {
      Alert.alert(
        'Name already exists',
        'Please choose a different workout name.',
      );
      return;
    }

    const workout: Workout = {
      id: editingId ?? `${Date.now()}`,
      name,
      sets,
      setTimeSeconds: setTime,
      restTimeSeconds: restTime,
      warmupTimeSeconds: warmupTime,
      isStandard: false,
    };

    let updatedWorkouts: Workout[];

    if (editingId) {
      updatedWorkouts = workouts.map(item =>
        item.id === editingId ? workout : item,
      );
    } else {
      updatedWorkouts = [...workouts, workout];
    }

    const saved = await persistWorkouts(updatedWorkouts);

    if (saved) {
      setScreen('home');
      setEditingId(null);
      setForm(EMPTY_FORM);
    }
  };

  // ------------------------------------------------
  // DELETE WORKOUT
  // ------------------------------------------------

  const deleteWorkout = (workout: Workout) => {
    if (workout.isStandard) return;

    Alert.alert(
      'Delete workout',
      `Are you sure you want to delete "${workout.name}"?`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void persistWorkouts(
              workouts.filter(item => item.id !== workout.id),
            );
          },
        },
      ],
    );
  };

  // ------------------------------------------------
  // OPEN TIMER
  // ------------------------------------------------

  const openTimer = (workout: Workout) => {
    const workoutPlan = buildWorkoutPlan(workout);

    setSelectedWorkout(workout);
    setPlan(workoutPlan);
    setElapsedMs(0);
    setStartedAt(null);
    setStatus('ready');
    setScreen('timer');
  };

  const backToHome = () => {
    if (status === 'running' || status === 'paused') {
      Alert.alert(
        'Workout in progress',
        'End your workout before returning home.',
      );
      return;
    }

    setSelectedWorkout(null);
    setPlan([]);
    setElapsedMs(0);
    setStartedAt(null);
    setStatus('ready');
    setScreen('home');
  };

  // ------------------------------------------------
  // TIMER ENGINE
  // ------------------------------------------------

  useEffect(() => {
    if (status !== 'running' || startedAt === null) {
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Date.now() - startedAt;

      const totalDuration =
        plan.length > 0
          ? plan[plan.length - 1].end * 1000
          : 0;

      if (elapsed >= totalDuration) {
        setElapsedMs(totalDuration);
        setStatus('completed');
      } else {
        setElapsedMs(elapsed);
      }
    }, 200);

    return () => clearInterval(interval);
  }, [status, startedAt, plan]);

  const startWorkout = () => {
    if (!selectedWorkout || plan.length === 0) return;

    setElapsedMs(0);
    setStartedAt(Date.now());
    setStatus('running');
  };

  const pauseWorkout = () => {
    if (startedAt === null || plan.length === 0) return;

    const elapsed = Date.now() - startedAt;
    const totalDuration = plan[plan.length - 1].end * 1000;

    if (elapsed >= totalDuration) {
      setElapsedMs(totalDuration);
      setStatus('completed');
      return;
    }

    setElapsedMs(elapsed);
    setStatus('paused');
  };

  const resumeWorkout = () => {
    setStartedAt(Date.now() - elapsedMs);
    setStatus('running');
  };

  const resetTimer = () => {
    if (!selectedWorkout) return;

    setElapsedMs(0);
    setStartedAt(null);
    setStatus('ready');
  };

  const confirmEndWorkout = () => {
    Alert.alert(
      'End workout?',
      'Are you sure you want to end this workout?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'End workout',
          style: 'destructive',
          onPress: () => {
          setStatus('ready');
          setPlan([]);
          setElapsedMs(0);
          setStartedAt(null);
          setSelectedWorkout(null);
          setScreen('home');
},
        },
      ],
    );
  };

  // ------------------------------------------------
  // TIMER DISPLAY VALUES
  // ------------------------------------------------

  const currentSegment = plan.find(
    segment => elapsedMs / 1000 < segment.end,
  );

  const remainingSeconds = currentSegment
    ? Math.max(
        0,
        Math.ceil(currentSegment.end - elapsedMs / 1000),
      )
    : 0;

  const phaseTitle =
    status === 'completed'
      ? 'WORKOUT COMPLETE'
      : currentSegment?.phase === 'warmup'
        ? 'WARM-UP'
        : currentSegment?.phase === 'rest'
          ? 'REST'
          : currentSegment?.phase === 'round'
            ? `ROUND ${currentSegment.round}`
            : 'READY';

  const phaseSubtitle =
    status === 'completed'
      ? 'GREAT WORK!'
      : currentSegment?.phase === 'warmup'
        ? 'GET READY'
        : currentSegment?.phase === 'rest'
          ? 'RECOVER'
          : currentSegment?.phase === 'round'
            ? 'WORK'
            : 'READY WHEN YOU ARE';

  const timerDisplay =
    status === 'completed'
      ? '00:00'
      : formatTime(
          status === 'ready'
            ? plan[0]?.duration ?? 0
            : remainingSeconds,
        );

  // ------------------------------------------------
  // LOADING SCREEN
  // ------------------------------------------------

  if (!storageLoaded) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.header}>WORKOUT TIMER</Text>
          <Text style={styles.note}>Loading your workouts...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ------------------------------------------------
  // HOME SCREEN
  // ------------------------------------------------

  if (screen === 'home') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.header}>WORKOUT TIMER</Text>
          <Text style={styles.subtitle}>MY WORKOUTS</Text>

          <View style={styles.workoutList}>
            {workouts.map(workout => (
              <View key={workout.id} style={styles.workoutCard}>
                <Text style={styles.workoutName}>
                  {workout.name}
                </Text>

                <Text style={styles.workoutRounds}>
                  {workout.sets} {workout.sets === 1 ? 'Round' : 'Rounds'}
                </Text>

                <View style={styles.workoutDetails}>
                  <Text style={styles.detailText}>
                    {formatTime(workout.setTimeSeconds)} work
                  </Text>
                  <Text style={styles.detailDot}>·</Text>
                  <Text style={styles.detailText}>
                    {formatTime(workout.restTimeSeconds)} rest
                  </Text>
                  <Text style={styles.detailDot}>·</Text>
                  <Text style={styles.detailText}>
                    {formatTime(workout.warmupTimeSeconds)} warm-up
                  </Text>
                </View>

                <Text style={styles.totalDuration}>
                  Total duration: {formatTime(workoutDuration(workout))}
                </Text>

                <Pressable
                  style={styles.startButton}
                  onPress={() => openTimer(workout)}
                >
                  <Text style={styles.buttonText}>
                    START WORKOUT
                  </Text>
                </Pressable>

                {!workout.isStandard && (
                  <View style={styles.workoutActions}>
                    <Pressable
                      onPress={() => openEditScreen(workout)}
                      style={styles.textAction}
                    >
                      <Text style={styles.editText}>EDIT</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => deleteWorkout(workout)}
                      style={styles.textAction}
                    >
                      <Text style={styles.deleteText}>DELETE</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ))}
          </View>

          <Pressable
            style={styles.createButton}
            onPress={openCreateScreen}
          >
            <Text style={styles.createPlus}>+</Text>
            <Text style={styles.createButtonText}>
              CREATE WORKOUT
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ------------------------------------------------
  // CREATE / EDIT WORKOUT SCREEN
  // ------------------------------------------------

  if (screen === 'create') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Pressable
            style={styles.backButton}
            onPress={() => setScreen('home')}
          >
            <Text style={styles.backText}>‹  MY WORKOUTS</Text>
          </Pressable>

          <Text style={styles.header}>
            {editingId ? 'EDIT WORKOUT' : 'CREATE WORKOUT'}
          </Text>

          <Text style={styles.subtitle}>
            CUSTOMISE YOUR SESSION
          </Text>

          <View style={styles.settingsCard}>
            <Text style={styles.fieldLabel}>WORKOUT NAME</Text>

            <TextInput
              style={styles.nameInput}
              value={form.name}
              onChangeText={value =>
                setForm(current => ({ ...current, name: value }))
              }
              placeholder="e.g. HIIT Boxing"
              placeholderTextColor="#777B85"
              maxLength={40}
              autoCapitalize="words"
            />

            <View style={styles.formDivider} />

            <Text style={styles.sectionTitle}>WORKOUT SETTINGS</Text>

            <SettingRow
              label="Sets"
              numeric
              value={form.sets}
              onChange={value => updateForm('sets', value)}
            />

            <SettingRow
              label="Set time"
              minutes={form.setMinutes}
              seconds={form.setSeconds}
              onMinutesChange={value =>
                updateForm('setMinutes', value)
              }
              onSecondsChange={value =>
                updateForm('setSeconds', value)
              }
            />

            <SettingRow
              label="Rest time"
              minutes={form.restMinutes}
              seconds={form.restSeconds}
              onMinutesChange={value =>
                updateForm('restMinutes', value)
              }
              onSecondsChange={value =>
                updateForm('restSeconds', value)
              }
            />

            <SettingRow
              label="Warm-up time"
              minutes={form.warmupMinutes}
              seconds={form.warmupSeconds}
              onMinutesChange={value =>
                updateForm('warmupMinutes', value)
              }
              onSecondsChange={value =>
                updateForm('warmupSeconds', value)
              }
            />
          </View>

          <Text style={styles.note}>
            Warm-up happens once before the first round.
            Rest happens only between rounds.
          </Text>

          <View style={styles.formSummary}>
            <Text style={styles.summaryLabel}>TOTAL WORKOUT</Text>
            <Text style={styles.summaryTime}>
              {formatTime(
                toTotalSeconds(form.warmupMinutes, form.warmupSeconds) +
                Number(form.sets || 0) *
                  toTotalSeconds(form.setMinutes, form.setSeconds) +
                Math.max(0, Number(form.sets || 0) - 1) *
                  toTotalSeconds(form.restMinutes, form.restSeconds),
              )}
            </Text>
          </View>

          <Pressable
            style={styles.startButton}
            onPress={() => void saveWorkout()}
          >
            <Text style={styles.buttonText}>
              {editingId ? 'SAVE CHANGES' : 'SAVE WORKOUT'}
            </Text>
          </Pressable>

          <Pressable
            style={styles.cancelButton}
            onPress={() => setScreen('home')}
          >
            <Text style={styles.cancelText}>CANCEL</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // ------------------------------------------------
  // TIMER SCREEN
  // ------------------------------------------------

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          style={styles.backButton}
          onPress={backToHome}
        >
          <Text style={styles.backText}>‹  MY WORKOUTS</Text>
        </Pressable>

        <Text style={styles.header}>WORKOUT TIMER</Text>
        <Text style={styles.subtitle}>
          {selectedWorkout?.name.toUpperCase()}
        </Text>

        <View style={styles.timerCard}>
          <Text style={styles.phaseTitle}>{phaseTitle}</Text>

          <Text style={styles.timer}>{timerDisplay}</Text>

          <Text style={styles.phaseSubtitle}>
            {phaseSubtitle}
          </Text>

          {status === 'ready' && (
            <Pressable
              style={styles.startButton}
              onPress={startWorkout}
            >
              <Text style={styles.buttonText}>START WORKOUT</Text>
            </Pressable>
          )}

          {status === 'running' && (
            <Pressable
              style={styles.pauseButton}
              onPress={pauseWorkout}
            >
              <Text style={styles.buttonText}>PAUSE</Text>
            </Pressable>
          )}

          {status === 'paused' && (
            <Pressable
              style={styles.startButton}
              onPress={resumeWorkout}
            >
              <Text style={styles.buttonText}>RESUME</Text>
            </Pressable>
          )}

          {status === 'completed' && (
            <Pressable
              style={styles.startButton}
              onPress={backToHome}
            >
              <Text style={styles.buttonText}>BACK TO WORKOUTS</Text>
            </Pressable>
          )}

          {(status === 'running' || status === 'paused') && (
            <Pressable
              style={styles.endButton}
              onPress={confirmEndWorkout}
            >
              <Text style={styles.buttonText}>END WORKOUT</Text>
            </Pressable>
          )}
        </View>

        {selectedWorkout && (
          <View style={styles.timerDetails}>
            <Text style={styles.sectionTitle}>SESSION DETAILS</Text>

            <DetailRow
              label="Sets"
              value={String(selectedWorkout.sets)}
            />

            <DetailRow
              label="Set time"
              value={formatTime(selectedWorkout.setTimeSeconds)}
            />

            <DetailRow
              label="Rest time"
              value={formatTime(selectedWorkout.restTimeSeconds)}
            />

            <DetailRow
              label="Warm-up"
              value={formatTime(selectedWorkout.warmupTimeSeconds)}
            />

            <DetailRow
              label="Total duration"
              value={formatTime(workoutDuration(selectedWorkout))}
            />
          </View>
        )}

        {status === 'ready' && (
          <Pressable
            style={styles.cancelButton}
            onPress={backToHome}
          >
            <Text style={styles.cancelText}>BACK TO WORKOUTS</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// --------------------------------------------------
// REUSABLE SETTINGS ROW
// --------------------------------------------------

type SettingRowProps = {
  label: string;
  numeric?: boolean;
  value?: string;
  onChange?: (value: string) => void;
  minutes?: string;
  seconds?: string;
  onMinutesChange?: (value: string) => void;
  onSecondsChange?: (value: string) => void;
};

function SettingRow({
  label,
  numeric = false,
  value,
  onChange,
  minutes,
  seconds,
  onMinutesChange,
  onSecondsChange,
}: SettingRowProps) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>

      <View style={styles.inputGroup}>
        {numeric ? (
          <TextInput
            style={[styles.input, styles.setsInput]}
            value={value}
            onChangeText={onChange}
            keyboardType="number-pad"
            maxLength={2}
          />
        ) : (
          <>
            <TextInput
              style={styles.input}
              value={minutes}
              onChangeText={onMinutesChange}
              keyboardType="number-pad"
              maxLength={3}
            />

            <Text style={styles.colon}>:</Text>

            <TextInput
              style={styles.input}
              value={seconds}
              onChangeText={onSecondsChange}
              keyboardType="number-pad"
              maxLength={2}
            />
          </>
        )}
      </View>
    </View>
  );
}

// --------------------------------------------------
// REUSABLE DETAIL ROW
// --------------------------------------------------

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

// --------------------------------------------------
// STYLES
// --------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#111318',
  },

  content: {
    padding: 24,
    paddingTop: 24,
    paddingBottom: 50,
  },

  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },

  header: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 2,
  },

  subtitle: {
    color: '#888C96',
    fontSize: 12,
    letterSpacing: 2,
    marginTop: 8,
    marginBottom: 28,
  },

  workoutList: {
    gap: 16,
  },

  workoutCard: {
    backgroundColor: '#1D2028',
    borderRadius: 16,
    padding: 20,
  },

  workoutName: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '700',
  },

  workoutRounds: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 12,
  },

  workoutDetails: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 8,
  },

  detailText: {
    color: '#A1A1AA',
    fontSize: 12,
  },

  detailDot: {
    color: '#777B85',
    marginHorizontal: 6,
  },

  totalDuration: {
    color: '#777B85',
    fontSize: 12,
    marginTop: 10,
    marginBottom: 18,
  },

  startButton: {
    backgroundColor: '#E5483F',
    padding: 17,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },

  buttonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
  },

  workoutActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 24,
    marginTop: 14,
  },

  textAction: {
    padding: 5,
  },

  editText: {
    color: '#A1A1AA',
    fontSize: 12,
    fontWeight: '800',
  },

  deleteText: {
    color: '#E57373',
    fontSize: 12,
    fontWeight: '800',
  },

  createButton: {
    borderWidth: 1,
    borderColor: '#555B68',
    borderStyle: 'dashed',
    borderRadius: 16,
    padding: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },

  createPlus: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '300',
  },

  createButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    marginTop: 6,
  },

  backButton: {
    marginBottom: 24,
    paddingVertical: 4,
  },

  backText: {
    color: '#A1A1AA',
    fontSize: 14,
    fontWeight: '700',
  },

  settingsCard: {
    backgroundColor: '#1D2028',
    borderRadius: 16,
    padding: 20,
  },

  fieldLabel: {
    color: '#888C96',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 10,
  },

  nameInput: {
    backgroundColor: '#30343E',
    color: '#FFFFFF',
    fontSize: 16,
    borderRadius: 8,
    padding: 14,
  },

  formDivider: {
    height: 1,
    backgroundColor: '#30343E',
    marginVertical: 24,
  },

  sectionTitle: {
    color: '#888C96',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 12,
  },

  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 12,
  },

  settingLabel: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '500',
    flexShrink: 1,
  },

  inputGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  input: {
    backgroundColor: '#30343E',
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    width: 48,
    paddingVertical: 10,
    borderRadius: 8,
  },

  setsInput: {
    width: 64,
  },

  colon: {
    color: '#FFFFFF',
    fontSize: 20,
    marginHorizontal: 5,
  },

  note: {
    color: '#888C96',
    fontSize: 12,
    lineHeight: 19,
    marginTop: 12,
  },

  formSummary: {
    backgroundColor: '#1D2028',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginVertical: 24,
  },

  summaryLabel: {
    color: '#888C96',
    fontSize: 12,
    letterSpacing: 2,
  },

  summaryTime: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '800',
    marginTop: 8,
  },

  cancelButton: {
    backgroundColor: '#30343E',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 14,
  },

  cancelText: {
    color: '#D4D4D8',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },

  timerCard: {
    backgroundColor: '#1D2028',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 28,
  },

  phaseTitle: {
    color: '#E5483F',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
  },

  timer: {
    color: '#FFFFFF',
    fontSize: 68,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    marginVertical: 12,
  },

  phaseSubtitle: {
    color: '#A1A1AA',
    fontSize: 13,
    letterSpacing: 2,
    marginBottom: 24,
  },

  pauseButton: {
    backgroundColor: '#D58A32',
    padding: 17,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },

  endButton: {
    backgroundColor: '#30343E',
    padding: 15,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginTop: 12,
  },

  timerDetails: {
    backgroundColor: '#1D2028',
    borderRadius: 16,
    padding: 20,
  },

  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#30343E',
  },

  detailValue: {
    color: '#A1A1AA',
    fontSize: 14,
    fontWeight: '700',
  },
});
