from typing import Iterable, List


def batch_list(items: Iterable, size: int) -> List[List]:
    lst = list(items)
    return [lst[i : i + size] for i in range(0, len(lst), size)]
