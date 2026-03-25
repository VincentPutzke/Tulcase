/** Todo item stored in todo_db/todos.json */
export interface TodoItem {
    id?: string;
    note: string;
    date: string;
    done: boolean;
    tags: string[];
}

/** Root shape of todos.json */
export interface TodoStore {
    items: TodoItem[];
}
