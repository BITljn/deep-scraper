from abc import ABC, abstractmethod

from sqlalchemy.ext.asyncio import AsyncSession


class BaseCollector(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...

    @abstractmethod
    async def collect(self, symbol: str, db: AsyncSession) -> int:
        """Run collection and return number of records upserted."""
        ...
