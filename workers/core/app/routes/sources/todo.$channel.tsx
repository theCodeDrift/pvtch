import type { Route } from './+types/todo.$channel';
import { useLoaderData, data, redirect } from 'react-router';
import { cloudflareEnvironmentContext } from '@/context';
import { nanoid } from 'nanoid';
import { useComfy, type ComfyEvents } from '@/hooks/use-comfy';
import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { useSearchParams } from 'react-router';
import z from 'zod';
import { useNoTheme } from '@/hooks/use-no-theme';
import {
  useDocumentVisibilityState,
  useLocalstorageState,
  useResizeObserverRef,
} from 'rooks';
import clsx from 'clsx';
import { CheckIcon } from '@/components/icons/check';

/* Disable HMR on this page */
// export const forceReload = Date.now();

/*
Basic UI that isn't so ugly
  font sizes etc are all relative to window size
Scroll and duplicate magic
Animations and look nice
Colors
*/

type Task = {
  username: string;
  description: string;
  completed: boolean;
  focused: number;
  ts: number;
  id: string;
};

type TaskUpdater = Dispatch<SetStateAction<Task[]>>;

const taskSorter = (streamer?: string) => (a: Task, b: Task) => {
  // streamer first
  if (streamer) {
    const aIsStreamer =
      a.username.toLocaleLowerCase() === streamer.toLocaleLowerCase();
    const bIsStreamer =
      b.username.toLocaleLowerCase() === streamer.toLocaleLowerCase();
    if (aIsStreamer && !bIsStreamer) {
      return -1;
    }
    if (!aIsStreamer && bIsStreamer) {
      return 1;
    }
  }

  // sort usernames a-z
  const nameComp = a.username.localeCompare(b.username);
  if (nameComp !== 0) {
    return nameComp;
  }

  // incomplete before complete
  if (a.completed !== b.completed) {
    return a.completed ? 1 : -1;
  }

  // higher focus before lower focus
  if (a.focused !== b.focused) {
    return b.focused - a.focused;
  }

  // older ts before newer
  if (a.ts !== b.ts) {
    return a.ts - b.ts;
  }

  return 0;
};

/**
 * Adds tasks for a user, up to `max` incomplete tasks. The limit is checked
 * against the current state inside the updater, never a captured copy, so
 * tasks completed or cleared since the command handler was bound free slots.
 */
const addTask = (
  user: string,
  additions: string[],
  max: number,
  updater: TaskUpdater
) => {
  updater((tasks) => {
    const existing = getTasks(user, false, tasks);
    const allowed = additions.slice(0, Math.max(0, max - existing.length));
    if (allowed.length === 0) {
      return tasks;
    }

    const nextItems = allowed.map((description) => ({
      username: user,
      description,
      completed: false,
      focused: 0,
      ts: Date.now(),
      id: nanoid(),
    }));

    return [...tasks, ...nextItems];
  });
};

/** Marks a task as done */
const completeTask = (
  user: string,
  taskIndexes: Set<number>,
  updater: TaskUpdater
) => {
  updater((tasks) => {
    const others = tasks.filter(
      (t) => t.username.toLocaleLowerCase() !== user.toLocaleLowerCase()
    );
    const userTasks = tasks
      .filter(
        (t) => t.username.toLocaleLowerCase() === user.toLocaleLowerCase()
      )
      .sort(taskSorter());

    for (const taskIndex of taskIndexes) {
      if (!userTasks[taskIndex - 1]) {
        // invalid index
        continue;
      }

      userTasks[taskIndex - 1] = {
        ...userTasks[taskIndex - 1],
        completed: true,
      };
    }

    return [...others, ...userTasks];
  });
};

/** Focusing a task sets the focused to the current unix timestamp */
const focusTask = (user: string, taskIndex: number, updater: TaskUpdater) => {
  const timestamp = Date.now();
  updater((tasks) => {
    const others = tasks.filter(
      (t) => t.username.toLocaleLowerCase() !== user.toLocaleLowerCase()
    );
    const userTasks = tasks
      .filter(
        (t) => t.username.toLocaleLowerCase() === user.toLocaleLowerCase()
      )
      .sort(taskSorter());

    if (taskIndex < 1 || taskIndex > userTasks.length) {
      // invalid index
      return tasks;
    }

    userTasks[taskIndex - 1] = {
      ...userTasks[taskIndex - 1],
      focused: timestamp,
    };

    return [...others, ...userTasks];
  });
};

/** Clear all tasks and wipe the tracker */
const resetTasks = (updater: TaskUpdater, forUser?: string) => {
  updater((_) => {
    if (!forUser) {
      return [];
    }

    const requestedUser = forUser.trim().replace('@', '');

    return _.filter(
      (t) =>
        t.username.toLocaleLowerCase() !== requestedUser.toLocaleLowerCase()
    );
  });
};

/** Remove all done tasks */
const cleanTasks = (updater: TaskUpdater) => {
  updater((tasks) => tasks.filter((t) => !t.completed));
};

const getTasks = (
  user: string,
  includeCompleted: boolean,
  tasks: Task[]
): Task[] => {
  return tasks
    .filter(
      (t) =>
        t.username.toLocaleLowerCase() === user.toLocaleLowerCase() &&
        (includeCompleted || !t.completed)
    )
    .sort(taskSorter());
};

const getAllTasks = (streamer: string, tasks: Task[]): Task[] => {
  return tasks.sort(taskSorter(streamer));
};

const paramsParser = z.object({
  debug: z.coerce.boolean().optional().default(false),
  help: z
    .string()
    .optional()
    .default('true')
    .transform((input) => input.toLocaleLowerCase() === 'true'),
  add: z.string().optional().default('add'),
  done: z.string().optional().default('done'),
  focus: z.string().optional().default('focus'),
  reset: z.string().optional().default('reset'),
  clear: z.string().optional().default('clear'),
  count: z.coerce.number().optional().default(5),
  bg: z.string().optional().default('rgba(34, 34, 34, 0.8)'),
  fg: z.string().optional().default('white'),
  demo: z
    .string()
    .optional()
    .default('false')
    .transform((input) => input.toLocaleLowerCase() === 'true'),
});

// Loader: fetch url param to loader data, before initializing comfy
// eslint-disable-next-line @typescript-eslint/require-await
export async function loader({ params, context }: Route.LoaderArgs) {
  const { channel } = params;

  // Check instance access control
  const env = context.get(cloudflareEnvironmentContext);
  const allowedUsersRaw = env.ALLOWED_USERS ?? '';
  if (allowedUsersRaw.length > 0) {
    const allowedUsers = allowedUsersRaw
      .split(',')
      .map((u) => u.trim().toLowerCase());
    if (!allowedUsers.includes(channel.toLowerCase())) {
      return redirect('/private');
    }
  }

  return data({
    channel,
  });
}

const emptyList: string[] = [];

/**
 * Primary Todo Sourc Component
 */
const DEMO_TASKS: Task[] = [
  {
    username: 'streamer',
    description: 'Plan the stream',
    completed: false,
    focused: 0,
    ts: 1,
    id: 'demo-1',
  },
  {
    username: 'streamer',
    description: 'Set up overlays',
    completed: false,
    focused: 0,
    ts: 2,
    id: 'demo-2',
  },
  {
    username: 'streamer',
    description: 'Update panels',
    completed: true,
    focused: 0,
    ts: 3,
    id: 'demo-3',
  },
  {
    username: 'viewer42',
    description: 'Fix the leaderboard',
    completed: false,
    focused: 0,
    ts: 4,
    id: 'demo-4',
  },
  {
    username: 'viewer42',
    description: 'Review channel points',
    completed: false,
    focused: 0,
    ts: 5,
    id: 'demo-5',
  },
  {
    username: 'viewer42',
    description: 'Clip that play',
    completed: true,
    focused: 0,
    ts: 6,
    id: 'demo-6',
  },
];

export default function TodoSource() {
  useNoTheme();
  const loaderData = useLoaderData<typeof loader>();
  const [rawParams] = useSearchParams();
  const params = useMemo(() => {
    return paramsParser.parse(Object.fromEntries(rawParams.entries()));
  }, []);
  const comfy = useComfy(params.demo ? false : loaderData.channel);
  const [tasks, updateTasks] = useLocalstorageState<Task[]>(
    'todos',
    params.demo ? DEMO_TASKS : []
  );
  const [enableScroll, setEnableScroll] = useState(false);
  const isDocumentVisible = useDocumentVisibilityState();
  const headerRef = useRef<HTMLDivElement>(null);
  const [ref] = useResizeObserverRef((entries: ResizeObserverEntry[]) => {
    const taskHeight = entries[0].contentRect.height;
    const windowHeight = globalThis.window.innerHeight;
    const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 0;

    setEnableScroll(taskHeight + headerHeight > windowHeight);
  });

  useEffect(() => {
    if (!isDocumentVisible) {
      return;
    }

    document.body.style.overflow = 'hidden';
  }, [isDocumentVisible]);

  useEffect(() => {
    if (!comfy) return;

    const onCommand: ComfyEvents['command'] = (
      user,
      command,
      message,
      flags,
      extra
    ) => {
      if (command.toLocaleLowerCase() === params.add.toLocaleLowerCase()) {
        const adds = message
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        addTask(user, adds, params.count, updateTasks);
      }

      if (command.toLocaleLowerCase() === params.done.toLocaleLowerCase()) {
        const dones: Set<number> = new Set();
        const allArgs = message
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        for (const arg of allArgs) {
          const argNum = Number.parseInt(arg);
          if (!Number.isNaN(argNum)) {
            dones.add(argNum);
          }
        }
        if (allArgs.length === 0) {
          dones.add(1);
        }

        completeTask(user, dones, updateTasks);
      }

      if (command.toLocaleLowerCase() === params.focus.toLocaleLowerCase()) {
        const argNum = Number.parseInt(message.trim());
        if (Number.isNaN(argNum)) {
          return;
        }
        focusTask(user, argNum, updateTasks);
      }

      if (
        command.toLocaleLowerCase() === params.reset.toLocaleLowerCase() &&
        (flags.mod || flags.broadcaster)
      ) {
        resetTasks(updateTasks, message.split(' ')[0]);
        setEnableScroll(false);
      }

      if (
        command.toLocaleLowerCase() === params.clear.toLocaleLowerCase() &&
        (flags.mod || flags.broadcaster)
      ) {
        cleanTasks(updateTasks);
        setEnableScroll(false);
      }
    };

    comfy.events.on('command', onCommand);

    if (isDocumentVisible) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      (globalThis.window as any).__onComfyCommand = onCommand;
    }

    return () => {
      comfy.events.off('command', onCommand);
    };
  }, [comfy, isDocumentVisible]);

  const tasksByUserName = useMemo(() => {
    // eslint-disable-next-line unicorn/no-array-reduce
    return getAllTasks(loaderData.channel, tasks).reduce(
      (acc, task) => {
        if (!acc[task.username]) {
          acc[task.username] = [];
        }
        acc[task.username].push(task);
        return acc;
      },
      {} as Record<string, Task[]>
    );
  }, [tasks]);

  // make sure the derrived value respects documentVisible state since it
  // depends on localStorage and you'll get hydration errors
  const usernames = isDocumentVisible
    ? Object.keys(tasksByUserName).sort()
    : emptyList;

  const MIN_SCROLL_DURATION = 8;
  const MAX_SCROLL_DURATION = 120;
  const PER_TASK_RATE = 1.4;
  const scrollDuration = Math.min(
    MAX_SCROLL_DURATION,
    Math.max(MIN_SCROLL_DURATION, tasks.length * PER_TASK_RATE)
  );

  return (
    <div
      className="w-full h-screen overflow-hidden rounded-md"
      style={{
        backgroundColor: params.bg,
        color: params.fg,
        fontSize: `max(16px, min(4.2vh, 24px))`,
      }}
    >
      {params.help && (
        <div
          ref={headerRef}
          className="p-4 italic border-b border-white/30 relative z-10"
          style={{
            backgroundColor: params.bg,
          }}
        >
          <div>
            <strong>!{params.add}</strong>&nbsp;&middot;&nbsp;
            <strong>!{params.done}</strong>&nbsp;&middot;&nbsp;
            <strong>!{params.focus}</strong>
          </div>
        </div>
      )}
      <div className="w-full h-full">
        <div
          ref={ref}
          className={enableScroll ? 'animate-infinite-scroll' : ''}
          style={{
            animationDuration: enableScroll ? `${scrollDuration}s` : undefined,
          }}
        >
          <TaskList
            usernames={usernames}
            tasksByUserName={tasksByUserName}
            max={params.count}
          />
          {enableScroll && (
            <TaskList
              usernames={usernames}
              tasksByUserName={tasksByUserName}
              max={params.count}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const TaskList: React.FC<{
  usernames: string[];
  tasksByUserName: Record<string, Task[]>;
  max: number;
}> = ({ usernames, tasksByUserName, max }) => {
  return (
    <>
      {usernames.map((username) => {
        const firstCompletedIndex = tasksByUserName[username].findIndex(
          (t) => t.completed
        );
        const insertAfter =
          firstCompletedIndex === -1
            ? tasksByUserName[username].length - 1
            : firstCompletedIndex - 1;
        const overTaskLimit =
          tasksByUserName[username].filter((t) => !t.completed).length >= max;

        return (
          <div key={username} className="py-4 mx-4 border-b border-white/30">
            {tasksByUserName[username].map((task, index) => (
              <React.Fragment key={task.id}>
                <div
                  className={clsx(
                    'flex flex-row gap-2 align-center pb-2 animate-appear',
                    task.completed ? 'opacity-50' : undefined
                  )}
                >
                  <div
                    className={clsx(
                      'w-[1.5em] h-[1.5em] aspect-square flex justify-center items-center',
                      task.completed
                        ? undefined
                        : 'rounded-full bg-[#000000]/30 '
                    )}
                  >
                    {task.completed ? <CheckIcon /> : <span>{index + 1}</span>}
                  </div>
                  <span
                    className={clsx(
                      'flex-shrink-0 font-bold',
                      task.completed ? 'line-through' : undefined
                    )}
                  >
                    {task.username}
                  </span>
                  <span
                    className={clsx(
                      'flex-grow truncate',
                      task.completed ? 'line-through' : undefined
                    )}
                  >
                    {task.description}
                  </span>
                </div>
                {overTaskLimit && index === insertAfter ? (
                  <div
                    key="task-limit-warning"
                    className="italic opacity-70 pb-2 animate-appear"
                  >
                    Unfinished task limit reached ({max} tasks)
                  </div>
                ) : undefined}
              </React.Fragment>
            ))}
          </div>
        );
      })}
    </>
  );
};
